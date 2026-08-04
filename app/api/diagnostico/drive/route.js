import { NextResponse } from "next/server";
import { driveApi, clientEmail } from "@/lib/google/auth";
import { getDriveFolders } from "@/lib/drive-folders";

// Mide qué puede y qué no puede hacer la service account en Drive, en vez de
// afirmarlo.
//
//   curl -s http://localhost:3000/api/diagnostico/drive
//
// La creencia a verificar: "una service account no tiene cuota de almacenamiento
// propia, así que no puede crear archivos en Drive salvo en una Unidad compartida".
// Si es cierta, bloquea `upload`. Pero NO bloquea `move` ni `deleteFile`, que
// operan sobre archivos ya existentes — esa distinción se me había pasado.
//
// Fases, de menos a más invasivo. Cada una solo corre si la anterior lo permite:
//
//   1. Identidad y cuota de la cuenta (about) — solo lectura.
//   2. Acceso a las carpetas configuradas y si son de Unidad compartida — solo lectura.
//   3. Crear un archivo de prueba. Acá aparece el error de cuota, si aparece.
//   4. Solo si el 3 funcionó: mover y mandar a la papelera ESE archivo, y después
//      borrarlo de verdad. Nunca se toca un archivo ajeno.
//
// Solo en desarrollo.

export const dynamic = "force-dynamic";

const NOMBRE_PRUEBA = "ZZ prueba migracion (borrar).txt";

/** Primer ID de carpeta utilizable del mapa `driveFolders`. */
function primeraCarpeta(folders) {
  const candidatos = [];
  const recorrer = (v, ruta) => {
    if (typeof v === "string" && v) candidatos.push({ ruta, id: v });
    else if (v && typeof v === "object") {
      for (const [k, sub] of Object.entries(v)) recorrer(sub, ruta ? `${ruta}.${k}` : k);
    }
  };
  recorrer(folders, "");
  return candidatos;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  const salida = { serviceAccount: clientEmail(), fases: {} };
  const drive = driveApi();

  // --- 1. Identidad y cuota ---------------------------------------------
  try {
    const about = await drive.about.get({ fields: "user,storageQuota,canCreateDrives" });
    salida.fases.identidad = {
      usuario: about.data.user,
      cuota: about.data.storageQuota,
      puedeCrearUnidadesCompartidas: about.data.canCreateDrives ?? null,
    };
  } catch (err) {
    salida.fases.identidad = { error: err.message };
  }

  // --- 1b. ¿Ve alguna Unidad compartida? --------------------------------
  try {
    const drives = await drive.drives.list({ pageSize: 10, fields: "drives(id,name)" });
    salida.fases.unidadesCompartidas = drives.data.drives || [];
  } catch (err) {
    salida.fases.unidadesCompartidas = { error: err.message };
  }

  // --- 2. Carpetas configuradas -----------------------------------------
  let carpetas = [];
  try {
    const folders = await getDriveFolders();
    carpetas = primeraCarpeta(folders);
    const detalle = [];
    // No se consultan las 25: alcanza una muestra para saber si hay acceso.
    for (const c of carpetas.slice(0, 4)) {
      try {
        const f = await drive.files.get({
          fileId: c.id,
          fields: "id,name,mimeType,driveId,owners(emailAddress),capabilities(canAddChildren)",
          supportsAllDrives: true,
        });
        detalle.push({
          ruta: c.ruta,
          nombre: f.data.name,
          // driveId presente = está en una Unidad compartida, donde la SA sí puede crear.
          enUnidadCompartida: !!f.data.driveId,
          dueño: f.data.owners?.[0]?.emailAddress ?? null,
          puedeAgregarArchivos: f.data.capabilities?.canAddChildren ?? null,
        });
      } catch (err) {
        detalle.push({ ruta: c.ruta, id: c.id, error: err.message });
      }
    }
    salida.fases.carpetas = { total: carpetas.length, muestra: detalle };
  } catch (err) {
    salida.fases.carpetas = { error: err.message };
  }

  // --- 3. ¿Puede crear un archivo? --------------------------------------
  const destino = carpetas[0];
  if (!destino) {
    salida.fases.crear = { probada: false, motivo: "sin carpetas configuradas que probar" };
  } else {
    let creado = null;
    try {
      const res = await drive.files.create({
        requestBody: { name: NOMBRE_PRUEBA, parents: [destino.id] },
        media: { mimeType: "text/plain", body: "prueba de migracion, se borra sola" },
        fields: "id,name,webViewLink,parents",
        supportsAllDrives: true,
      });
      creado = res.data;
      salida.fases.crear = { puede: true, carpeta: destino.ruta, archivo: { id: creado.id, nombre: creado.name } };
    } catch (err) {
      salida.fases.crear = {
        puede: false,
        carpeta: destino.ruta,
        error: err.message,
        // Es LA firma del problema. Si aparece otra cosa, el diagnóstico cambia.
        esCuotaDeServiceAccount: /storage quota|storageQuotaExceeded/i.test(err.message || ""),
      };
    }

    // --- 4. Mover y papelera, solo sobre el archivo propio -------------
    if (creado) {
      const otra = carpetas[1] || carpetas[0];
      try {
        await drive.files.update({
          fileId: creado.id,
          addParents: otra.id,
          removeParents: destino.id,
          fields: "id,parents",
          supportsAllDrives: true,
        });
        salida.fases.mover = { puede: true, de: destino.ruta, a: otra.ruta };
      } catch (err) {
        salida.fases.mover = { puede: false, error: err.message };
      }
      try {
        await drive.files.update({
          fileId: creado.id,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
        salida.fases.papelera = { puede: true };
      } catch (err) {
        salida.fases.papelera = { puede: false, error: err.message };
      }
      // Limpieza real: la papelera del dueño conservaría el archivo 30 días.
      try {
        await drive.files.delete({ fileId: creado.id, supportsAllDrives: true });
        salida.fases.limpieza = "archivo de prueba eliminado";
      } catch (err) {
        salida.fases.limpieza = "NO se pudo eliminar " + creado.id + ": " + err.message;
      }
    }
  }

  const c = salida.fases.crear || {};
  salida.veredicto = c.puede
    ? "la service account SÍ puede crear archivos: upload/move/deleteFile se pueden migrar sin esperar nada"
    : c.esCuotaDeServiceAccount
      ? "confirmado: falta cuota de Drive. `upload` necesita Unidad compartida o delegación; `move` y `deleteFile` NO dependen de crear y quedan por probar aparte"
      : c.probada === false
        ? "no se pudo probar: " + c.motivo
        : "no puede crear, pero el error NO es de cuota — revisar el mensaje antes de asumir el bloqueo";

  return NextResponse.json(salida);
}
