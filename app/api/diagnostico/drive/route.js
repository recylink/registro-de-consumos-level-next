import { NextResponse } from "next/server";
import { driveApi, clientEmail } from "@/lib/google/auth";
import { getDriveFolders } from "@/lib/drive-folders";
import { trashInDrive, uploadToDrive } from "@/lib/drive";

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

  // --- 1c. ¿Ve algo DENTRO de una Unidad compartida? --------------------
  //
  // `drives.list` vacío tiene dos lecturas distintas: que la SA no sea miembro de
  // ninguna unidad, o que sí tenga acceso a una carpeta suelta de adentro sin ser
  // miembro de la unidad (compartir una carpeta y agregar un miembro son cosas
  // distintas en Drive, y la primera no aparece en `drives.list`). Esta búsqueda
  // las separa: lista lo que la SA ve en cualquier corpus y marca lo que trae
  // `driveId`, que es la señal de "esto vive en una Unidad compartida".
  try {
    const res = await drive.files.list({
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: "files(id,name,driveId,owners(emailAddress))",
      pageSize: 25,
    });
    const vistas = res.data.files || [];
    salida.fases.carpetasVisibles = {
      total: vistas.length,
      enUnidadCompartida: vistas
        .filter((f) => f.driveId)
        .map((f) => ({ nombre: f.name, id: f.id, driveId: f.driveId })),
      enMiUnidadDeAlguien: vistas
        .filter((f) => !f.driveId)
        .map((f) => ({ nombre: f.name, dueño: f.owners?.[0]?.emailAddress ?? null })),
    };
  } catch (err) {
    salida.fases.carpetasVisibles = { error: err.message };
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

  // --- 5. move y deleteFile sobre un archivo AJENO -----------------------
  //
  // La fase 4 nunca corre mientras crear falle por cuota, y así `move` y
  // `deleteFile` quedaban sin medir por depender de una limitación que no las
  // afecta: operan sobre archivos que ya existen. Acá el archivo lo crea el Apps
  // Script —que corre como el dueño de la carpeta y sí tiene cuota, es lo que hace
  // hoy la app— y el SDK solo lo mueve y lo borra. Es exactamente el reparto que
  // tendría la migración si `upload` se quedara en el .gs.
  //
  // Un archivo ajeno no es lo mismo que uno propio: la service account es Editor de
  // la carpeta, no dueña del archivo, y Drive distingue las dos cosas al borrar.
  if (carpetas.length) {
    const origen = carpetas[0];
    const otra = carpetas[1] || carpetas[0];
    const fase = {};
    let fileId = null;
    try {
      const file = new File(["prueba de migracion, se borra sola"], NOMBRE_PRUEBA, {
        type: "text/plain",
      });
      const up = await uploadToDrive(file, origen.id);
      fileId = up.id;
      fase.creadoPorAppsScript = { ok: true, fileId };
    } catch (err) {
      fase.creadoPorAppsScript = { ok: false, error: err.message };
    }

    if (fileId) {
      try {
        await drive.files.update({
          fileId,
          addParents: otra.id,
          removeParents: origen.id,
          fields: "id,parents",
          supportsAllDrives: true,
        });
        fase.moverPorSdk = { puede: true, de: origen.ruta, a: otra.ruta };
      } catch (err) {
        fase.moverPorSdk = { puede: false, error: err.message };
      }
      // `deleteFile` del .gs manda a la papelera, no elimina. Se prueba lo mismo.
      try {
        await drive.files.update({
          fileId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
        fase.papeleraPorSdk = { puede: true };
      } catch (err) {
        fase.papeleraPorSdk = { puede: false, error: err.message };
      }
      // Limpieza. Si el SDK no puede tocar el archivo ajeno, la prueba no puede
      // dejarlo tirado en la carpeta: se limpia por el Apps Script, que corre como
      // el dueño. Es el mismo `deleteFile` que usa el botón de borrar de la app.
      try {
        await drive.files.delete({ fileId, supportsAllDrives: true });
        fase.limpieza = "eliminado por el SDK";
      } catch (errSdk) {
        try {
          await trashInDrive(fileId);
          fase.limpieza = "el SDK no pudo (" + errSdk.message + "); a la papelera por Apps Script";
        } catch (errGs) {
          fase.limpieza = "QUEDÓ SIN BORRAR " + fileId + ": SDK " + errSdk.message + " / Apps Script " + errGs.message;
        }
      }
    }
    salida.fases.ajeno = fase;
  }

  // --- 6. La prueba que decide el bloque Drive --------------------------
  //
  // En una Unidad compartida los archivos no son de nadie: son de la unidad. Por eso
  // la falta de cuota de la service account deja de importar, y por eso el permiso
  // de borrar sale de la membresía y no de la propiedad. Las dos cosas que hoy
  // bloquean `upload`/`setup` y `deleteFile` deberían caer del mismo golpe — pero
  // "debería" no alcanza, así que se crea, se manda a la papelera y se elimina un
  // archivo de prueba adentro.
  const enUnidad = (salida.fases.carpetasVisibles || {}).enUnidadCompartida || [];
  if (!enUnidad.length) {
    salida.fases.unidadCompartida = {
      probada: false,
      motivo: "la SA no ve ninguna carpeta con driveId",
    };
  } else {
    const carpeta = enUnidad[0];
    const fase = { carpeta: carpeta.nombre, driveId: carpeta.driveId };

    // Antes de intentar, preguntar. `capabilities` dice qué puede hacer ESTA cuenta
    // sobre ESTA carpeta, y distingue "no tengo permiso" de "el permiso está pero
    // algo más falla" — que con un "Unknown Error." de Drive es justo la duda.
    try {
      const meta = await drive.files.get({
        fileId: carpeta.id,
        fields: "id,name,driveId,capabilities(canAddChildren,canEdit,canDelete,canTrash)",
        supportsAllDrives: true,
      });
      fase.permisos = meta.data.capabilities;
    } catch (err) {
      fase.permisos = { error: err.message };
    }

    let id = null;
    try {
      const res = await drive.files.create({
        requestBody: { name: NOMBRE_PRUEBA, parents: [carpeta.id] },
        media: { mimeType: "text/plain", body: "prueba de migracion, se borra sola" },
        fields: "id,name,driveId",
        supportsAllDrives: true,
      });
      id = res.data.id;
      fase.crear = { puede: true, fileId: id };
    } catch (err) {
      fase.crear = {
        puede: false,
        error: err.message,
        // "Unknown Error." es lo que googleapis pone en `message` cuando la API
        // contestó un error sin texto útil. El detalle está en la respuesta HTTP.
        codigo: err.code ?? null,
        detalle: err.errors ?? err.response?.data?.error ?? null,
        esCuotaDeServiceAccount: /storage quota|storageQuotaExceeded/i.test(err.message || ""),
      };
    }
    if (id) {
      try {
        await drive.files.update({
          fileId: id,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
        fase.papelera = { puede: true };
      } catch (err) {
        fase.papelera = { puede: false, error: err.message };
      }
      try {
        await drive.files.delete({ fileId: id, supportsAllDrives: true });
        fase.limpieza = "eliminado";
      } catch (err) {
        fase.limpieza = "QUEDÓ SIN BORRAR " + id + ": " + err.message;
      }
    }
    salida.fases.unidadCompartida = fase;
  }

  const c = salida.fases.crear || {};
  const aj = salida.fases.ajeno || {};
  const uc = salida.fases.unidadCompartida || {};
  salida.veredicto = uc.crear?.puede
    ? "DESBLOQUEADO en Unidad compartida (" +
      uc.carpeta +
      "): la SA crea" +
      (uc.papelera?.puede ? " y borra" : " pero NO borra: " + uc.papelera?.error) +
      ". El bloque Drive se migra moviendo las carpetas de la app adentro de esa unidad."
    : c.puede
    ? "la service account SÍ puede crear archivos: upload/move/deleteFile se pueden migrar sin esperar nada"
    : c.esCuotaDeServiceAccount
      ? "confirmado: falta cuota de Drive, así que `upload` y `setup` necesitan Unidad compartida o delegación. " +
        (aj.moverPorSdk?.puede && aj.papeleraPorSdk?.puede
          ? "Pero `move` y `deleteFile` SÍ funcionan sobre archivos ajenos: se pueden migrar ya."
          : "Y sobre archivos ajenos tampoco puede " +
            [
              aj.moverPorSdk?.puede === false ? "mover" : null,
              aj.papeleraPorSdk?.puede === false ? "mandar a la papelera" : null,
            ]
              .filter(Boolean)
              .join(" ni ") +
            " — ver fases.ajeno.")
      : c.probada === false
        ? "no se pudo probar: " + c.motivo
        : "no puede crear, pero el error NO es de cuota — revisar el mensaje antes de asumir el bloqueo";

  return NextResponse.json(salida);
}
