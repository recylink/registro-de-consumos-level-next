import { NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/apps-script";
import { SDK_POST } from "@/lib/google/actions";
import { getDriveFolders } from "@/lib/drive-folders";
import {
  buscarSubcarpetas,
  estadoArchivo,
  mandarAPapelera,
  padresDe,
} from "@/lib/google/drive-api";
import { driveApi } from "@/lib/google/auth";
import { trashInDrive, uploadToDrive } from "@/lib/drive";

// Verifica el bloque E: las actions de Drive, comparando el EFECTO sobre Drive y no
// la respuesta. Las dos contestan `{ ok: true }` hagan lo que hagan, así que
// comparar respuestas no prueba nada.
//
//   curl -s -X POST http://localhost:3000/api/migracion/probe-e
//
// QUÉ SE COMPARA
//
// Un movimiento tiene un solo efecto observable: en qué carpetas queda el archivo.
// Se sube un archivo de prueba a la carpeta A y se lo mueve A→B con un backend y
// B→A con el otro, mirando los padres después de cada paso. Si los dos backends
// dejan el archivo en el mismo lugar, `move` hace lo mismo por los dos caminos.
//
// Se prueba además el caso que la implementación nueva trata distinto: mover un
// archivo a la carpeta en la que YA está. El Apps Script hacía addFile y después
// removeFile del mismo padre, y en una Unidad compartida eso puede dejar al archivo
// sin ninguna carpeta; el SDK ignora el removeParents cuando coincide con el
// addParents. Acá se verifica que el archivo siga teniendo un padre después.
//
// El archivo de prueba se sube y se borra por `uploadToDrive`/`trashInDrive`, o sea
// por el camino real de la app: cuando se escribió esto ese camino era el /exec, para
// que la prueba de `move` no dependiera de `upload`, que se migraba aparte.
//
// YA NO SE PUEDE CORRER. El script `v6` retiró `upload`, `move` y `deleteFile`, así
// que el lado "Apps Script" de la comparación falla entero. Queda como registro de
// cómo se verificó el bloque, no como algo re-ejecutable. Ver ARQUITECTURA.md →
// "Verificación".
//
// Solo en desarrollo.

export const dynamic = "force-dynamic";

/**
 * El /exec falla cada tantas llamadas seguidas —acá aparece como "Apps Script HTTP
 * 404"—, y esta prueba le pega muchas veces en pocos segundos. Sin reintento, la
 * intermitencia del backend viejo se reporta como una diferencia entre backends.
 * Mismo criterio que /api/migracion/diff.
 */
async function conReintento(fn, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw ultimo;
}

/** Sube el archivo de prueba por el camino real de la app. El reintento es de cuando
 *  ese camino era el /exec. */
function subirDePrueba(nombre, carpeta, contenido = "probe-e") {
  return conReintento(() =>
    uploadToDrive(new File([contenido], nombre, { type: "text/plain" }), carpeta),
  );
}

async function pasos(fileId, A, B) {
  const out = [];
  // Un paso que falla no corta la prueba: el fallo ES el dato. Desde que las
  // carpetas viven en una Unidad compartida, el paso del Apps Script falla siempre
  // —`addFile`/`removeFile` de DriveApp no soportan unidades compartidas— y eso es
  // justamente lo que hay que dejar registrado.
  const correr = async (paso, fn) => {
    let error = null;
    try {
      await fn();
    } catch (err) {
      error = err.message;
    }
    out.push({ paso, error, carpetas: await padresDe(fileId) });
  };

  await correr("inicial", () => {});
  await correr("appsScript A→B", () =>
    conReintento(() =>
      appsScriptPost({ action: "move", fileId, fromFolderId: A, toFolderId: B }),
    ),
  );
  await correr("sdk A→B", () => SDK_POST.move({ fileId, fromFolderId: A, toFolderId: B }));
  await correr("sdk B→A", () => SDK_POST.move({ fileId, fromFolderId: B, toFolderId: A }));
  // Mover a donde ya está. El archivo tiene que seguir teniendo padre.
  await correr("sdk A→A", () => SDK_POST.move({ fileId, fromFolderId: A, toFolderId: A }));

  return out;
}

/**
 * `deleteFile` por los dos backends, sobre un archivo cada uno.
 *
 * No se puede comparar sobre el MISMO archivo: el primero que corra lo deja en la
 * papelera y el segundo no tendría nada que probar. Así que se sube uno para cada
 * uno y se compara el estado final, que es el único efecto observable — `trashed`.
 *
 * Los dos archivos quedan en la papelera al terminar, que es exactamente lo que la
 * prueba verifica: no hace falta limpiarlos aparte.
 */
async function probarBorrado(carpeta) {
  const casos = [
    ["appsScript", (fileId) => conReintento(() => appsScriptPost({ action: "deleteFile", fileId }))],
    ["sdk", (fileId) => SDK_POST.deleteFile({ fileId })],
  ];
  const out = {};
  for (const [nombre, borrar] of casos) {
    try {
      const up = await subirDePrueba(`ZZ probe-e ${nombre} (borrar).txt`, carpeta);
      const antes = await estadoArchivo(up.id);
      await borrar(up.id);
      const despues = await estadoArchivo(up.id);
      out[nombre] = {
        fileId: up.id,
        antes: antes.trashed,
        despues: despues.trashed,
        // Lo que tiene que pasar: estaba fuera de la papelera y quedó adentro.
        ok: antes.trashed === false && despues.trashed === true,
      };
    } catch (err) {
      out[nombre] = { ok: false, error: err.message };
    }
  }
  out.mismoEfecto = out.appsScript?.despues === out.sdk?.despues;
  return out;
}

/**
 * `upload` por los dos backends, con la misma entrada.
 *
 * Lo que se compara no es la respuesta sino el archivo que queda: nombre, tipo,
 * tamaño, contenido y en qué carpeta cayó. El contenido importa porque el camino del
 * base64 cambió —`Utilities.base64Decode` + `newBlob` contra `Buffer.from` + un
 * stream— y un binario mal decodificado se sube igual, sin ningún error: la factura
 * queda corrupta y nadie se entera hasta que alguien la abre.
 *
 * Se usa un contenido con bytes que no son ASCII a propósito, que es donde una
 * decodificación mal hecha se rompe. `Ñ`, un emoji y un byte 0x00.
 */
const CONTENIDO = new Uint8Array([0xc3, 0xb1, 0x00, 0xf0, 0x9f, 0x94, 0x8c, 0x41, 0xff]);

async function probarSubida(carpeta, sub) {
  const casos = [
    ["appsScript", (body) => conReintento(() => appsScriptPost({ action: "upload", ...body }))],
    ["sdk", (body) => SDK_POST.upload(body)],
  ];
  const out = {};
  for (const [nombre, subir] of casos) {
    try {
      const res = await subir({
        name: `ZZ probe-e ${nombre}.bin`,
        mimeType: "application/octet-stream",
        base64: Buffer.from(CONTENIDO).toString("base64"),
        folderId: carpeta,
        subfolders: sub,
      });
      const detalle = await detalleArchivo(res.id);
      out[nombre] = {
        id: res.id,
        // El link es lo que la app guarda en la planilla. `getUrl()` de DriveApp y
        // `webViewLink` del SDK no son el mismo string, así que se mira la forma.
        link: res.link,
        ...detalle,
      };
      await trashInDrive(res.id);
    } catch (err) {
      out[nombre] = { error: err.message };
    }
  }

  // Los archivos ya están en la papelera, pero la subcarpeta que se creó para
  // probarlas queda. Se manda a la papelera entera, por su nombre: es la que armó
  // esta prueba y ninguna otra se llama así.
  try {
    const [creada] = await buscarSubcarpetas(carpeta, sub[0]);
    if (creada) await mandarAPapelera(creada.id);
    out.limpiezaSubcarpeta = creada ? "a la papelera" : "no quedó ninguna";
  } catch (err) {
    out.limpiezaSubcarpeta = "NO se pudo borrar: " + err.message;
  }

  const a = out.appsScript || {};
  const s = out.sdk || {};
  out.comparacion = {
    mismoTipo: a.mimeType === s.mimeType,
    mismoTamaño: a.tamaño === s.tamaño,
    // La comparación que de verdad importa: los bytes que quedaron en Drive.
    mismoContenido: a.contenido === s.contenido,
    contenidoIntacto: s.contenido === Buffer.from(CONTENIDO).toString("base64"),
    // Los dos tienen que haber creado —o reusado— la misma subcarpeta.
    mismaCarpeta: JSON.stringify(a.parents) === JSON.stringify(s.parents),
    subcarpetaCreada: (s.parents || [])[0] !== carpeta,
  };
  return out;
}

/** Metadatos + contenido real de un archivo de Drive, en base64. */
async function detalleArchivo(fileId) {
  const drive = driveApi();
  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size,parents",
    supportsAllDrives: true,
  });
  const bin = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return {
    nombre: meta.data.name,
    mimeType: meta.data.mimeType,
    tamaño: Number(meta.data.size),
    parents: meta.data.parents || [],
    contenido: Buffer.from(bin.data).toString("base64"),
  };
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  const folders = await getDriveFolders();
  const A = folders.fotosPorCompletar;
  const B = folders.fotosProcesados;
  if (!A || !B) {
    return NextResponse.json(
      { error: "faltan las carpetas fotosPorCompletar / fotosProcesados en la config" },
      { status: 412 },
    );
  }

  const salida = { carpetas: { A, B } };
  let fileId = null;
  try {
    const up = await subirDePrueba("ZZ probe-e (borrar).txt", A);
    fileId = up.id;
    salida.archivo = fileId;
    salida.pasos = await pasos(fileId, A, B);

    const p = Object.fromEntries(salida.pasos.map((x) => [x.paso, x]));
    const igual = (paso, carpeta) => JSON.stringify(p[paso]?.carpetas) === JSON.stringify([carpeta]);
    salida.veredicto = {
      // El backend viejo ya no puede mover nada de la Unidad compartida. Si esto
      // dejara de ser cierto, la migración de `move` deja de ser urgente.
      appsScriptFalla: p["appsScript A→B"]?.error ?? "no falló (¡cambió algo!)",
      sdkMueveDeIda: igual("sdk A→B", B),
      sdkMueveDeVuelta: igual("sdk B→A", A),
      // La trampa: mover a la carpeta donde ya está no puede dejar al archivo
      // huérfano.
      moverADondeYaEsta: igual("sdk A→A", A),
    };

    salida.borrado = await probarBorrado(A);

    // Subcarpetas: la ruta que arma Medidores para un respaldo, <medidor>/<mes>. El
    // nombre lleva una comilla a propósito — sale de un campo que tipea el usuario y
    // rompería la query de Drive si no se escapara.
    salida.subida = await probarSubida(A, ["ZZ probe-e Medidor d'prueba", "2026-08"]);
  } catch (err) {
    salida.error = err.message;
  } finally {
    if (fileId) {
      try {
        await trashInDrive(fileId);
        salida.limpieza = "a la papelera";
      } catch (err) {
        salida.limpieza = "QUEDÓ SIN BORRAR " + fileId + ": " + err.message;
      }
    }
  }

  return NextResponse.json(salida);
}
