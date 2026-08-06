import "server-only";
import { Readable } from "node:stream";
import { driveApi } from "./auth";

const MIME_CARPETA = "application/vnd.google-apps.folder";

// Capa baja de Drive, equivalente a sheets-api.js: acá viven las llamadas a la API
// y sus rarezas; en actions.js viven las actions que replican al Apps Script.
//
// TODAS las llamadas llevan `supportsAllDrives: true`. No es decorativo: los
// archivos de la app viven en una Unidad compartida desde el 2026-08-06, y sin ese
// flag la API se comporta como si no existieran — `files.get` contesta
// "File not found" sobre un archivo que está ahí. Es la clase de error que se
// diagnostica como permisos y no lo es.
//
// Por qué se puede escribir en Drive con la service account, cuando durante semanas
// no se pudo: dentro de una Unidad compartida los archivos son de la unidad y no de
// quien los crea, así que la falta de cuota de una service account
// (`storageQuota.limit: "0"`) deja de importar. En "Mi unidad" de una persona sigue
// sin poder crear, y tampoco puede mandar a la papelera lo que no es suyo. Medido
// con /api/diagnostico/drive.

/**
 * Mueve un archivo entre carpetas. `de` y `a` son opcionales por separado, igual
 * que en el original: solo agregar padre, o solo quitarlo.
 *
 * Drive no tiene "mover": tiene padres. Un archivo puede estar en varias carpetas a
 * la vez, así que mover es agregar uno y quitar el otro en el mismo request — y en
 * el mismo request importa, porque hacerlo en dos deja una ventana en la que el
 * archivo está en las dos carpetas o en ninguna.
 */
export async function moverArchivo({ fileId, de, a }) {
  const res = await driveApi().files.update({
    fileId,
    addParents: a || undefined,
    // Quitar el mismo padre que se acaba de agregar deja el archivo huérfano, y en
    // una Unidad compartida la API lo rechaza. Mover algo a donde ya está es una
    // operación válida que no hace nada.
    removeParents: de && de !== a ? de : undefined,
    fields: "id,parents",
    supportsAllDrives: true,
  });
  return { id: res.data.id, parents: res.data.parents || [] };
}

/**
 * Un valor dentro de una query de Drive va entre comillas simples, así que una
 * comilla en el nombre rompe la consulta. Los nombres de subcarpeta salen de datos
 * del usuario —`meterFolderName` arma "Medidor 1 (N° 123)" con lo que se tipeó—,
 * así que esto no es hipotético.
 */
function escapar(valor) {
  return String(valor).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Subcarpetas con ese nombre, más viejas primero. */
export async function buscarSubcarpetas(padre, nombre) {
  const res = await driveApi().files.list({
    q:
      `'${escapar(padre)}' in parents and name = '${escapar(nombre)}' and ` +
      `mimeType = '${MIME_CARPETA}' and trashed = false`,
    fields: "files(id,name,createdTime)",
    orderBy: "createdTime",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

/**
 * Baja por una ruta de subcarpetas creando las que falten, y devuelve el id de la
 * última. Ruta vacía = la carpeta base.
 *
 * LA CARRERA. El original hacía esto adentro de `withLock` (apps-script.gs:268)
 * porque dos subidas simultáneas al mismo medidor y mes leen "no existe" a la vez y
 * crean dos carpetas con el mismo nombre — Drive lo permite, no hay unicidad por
 * nombre. El SDK no tiene LockService.
 *
 * En vez de un lock, se converge: después de crear se vuelve a listar, y si aparece
 * más de una gana la más vieja. Las dos subidas terminan en la misma carpeta. La que
 * perdió borra la suya, que está recién creada y vacía por construcción, así que no
 * se pierde nada de nadie.
 */
export async function asegurarSubcarpetas(carpetaBase, ruta) {
  let actual = carpetaBase;
  for (const cruda of ruta || []) {
    const nombre = String(cruda || "").trim();
    if (!nombre) continue;

    const existentes = await buscarSubcarpetas(actual, nombre);
    if (existentes.length) {
      actual = existentes[0].id;
      continue;
    }

    const creada = await driveApi().files.create({
      requestBody: { name: nombre, mimeType: MIME_CARPETA, parents: [actual] },
      fields: "id",
      supportsAllDrives: true,
    });

    const tras = await buscarSubcarpetas(actual, nombre);
    const ganadora = tras[0]?.id ?? creada.data.id;
    if (ganadora !== creada.data.id) {
      // Otra subida creó la misma carpeta primero. La nuestra está vacía.
      await mandarAPapelera(creada.data.id).catch(() => {});
    }
    actual = ganadora;
  }
  return actual;
}

/**
 * Crea un archivo con contenido binario. `contenido` es un Buffer.
 *
 * `webViewLink` es el equivalente de `file.getUrl()` de DriveApp: el link que abre
 * el archivo en Drive, que es lo que la app guarda en la planilla y muestra como
 * "ver adjunto".
 */
export async function crearArchivo({ nombre, mimeType, contenido, carpeta }) {
  const res = await driveApi().files.create({
    requestBody: { name: nombre, parents: [carpeta] },
    media: { mimeType, body: Readable.from(contenido) },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });
  return { id: res.data.id, link: res.data.webViewLink };
}

/**
 * Manda un archivo a la papelera. NO lo elimina: es recuperable, y en una Unidad
 * compartida se purga sola a los 30 días.
 *
 * `files.delete` existe y sería la eliminación de verdad, pero no es lo que hacía
 * el original ni lo que espera la app —la papelera es el único deshacer que tiene
 * el usuario— y además la service account no puede: `canDelete: false` sobre la
 * carpeta compartida, porque no es Administradora de la unidad.
 */
export async function mandarAPapelera(fileId) {
  await driveApi().files.update({
    fileId,
    requestBody: { trashed: true },
    fields: "id,trashed",
    supportsAllDrives: true,
  });
}

/** Carpetas en las que está un archivo. Para verificar un movimiento. */
export async function padresDe(fileId) {
  const res = await driveApi().files.get({
    fileId,
    fields: "id,name,parents,driveId",
    supportsAllDrives: true,
  });
  return res.data.parents || [];
}

/** Estado de un archivo, para verificar el efecto de una operación. */
export async function estadoArchivo(fileId) {
  const res = await driveApi().files.get({
    fileId,
    fields: "id,name,trashed,parents",
    supportsAllDrives: true,
  });
  return { nombre: res.data.name, trashed: res.data.trashed, parents: res.data.parents || [] };
}
