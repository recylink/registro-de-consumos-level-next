import "server-only";
import { driveApi } from "./auth";

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

/** Carpetas en las que está un archivo. Para verificar un movimiento. */
export async function padresDe(fileId) {
  const res = await driveApi().files.get({
    fileId,
    fields: "id,name,parents,driveId",
    supportsAllDrives: true,
  });
  return res.data.parents || [];
}
