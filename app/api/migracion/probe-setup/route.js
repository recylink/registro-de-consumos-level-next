import { NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/apps-script";
import { SDK_POST } from "@/lib/google/actions";
import { SHEETS } from "@/lib/instance";
import { driveApi } from "@/lib/google/auth";
import { getDriveFolders } from "@/lib/drive-folders";
import { asegurarSubcarpetas, mandarAPapelera } from "@/lib/google/drive-api";
import { leerHoja } from "@/lib/google/sheets-api";

// Verifica `setup` (bloque G): la provisión que crea el árbol de ~25 carpetas de una
// instancia nueva y deja los IDs en la clave `driveFolders` de la hoja "Config".
//
//   curl -s -X POST http://localhost:3000/api/migracion/probe-setup
//
// EL CUIDADO QUE HAY QUE TENER
//
// `setup` no es una action inocente: ESCRIBE `driveFolders`. Correrla contra la raíz
// real sería jugar con la configuración de la instancia —si por cualquier motivo
// resolviera un ID distinto, la app quedaría apuntando a carpetas equivocadas y los
// adjuntos viejos se volverían inalcanzables—. Así que:
//
//   1. cada backend provisiona su PROPIA carpeta raíz de juguete, vacía;
//   2. el valor real de `driveFolders` se guarda antes y se restaura al final,
//      pase lo que pase (finally);
//   3. las carpetas de juguete se mandan a la papelera.
//
// QUÉ SE COMPARA
//
// No los IDs —son distintos por definición, cada backend armó su propio árbol— sino
// la FORMA: las mismas claves en `driveFolders`, y el mismo árbol de nombres colgando
// de la raíz. Eso es lo que hace que la app encuentre lo que busca.
//
// Y la promesa que `setup` tiene que cumplir: correrlo dos veces no duplica nada ni
// cambia ningún ID. Se corre el del SDK dos veces sobre la misma raíz y se comparan
// los IDs con los de la primera pasada.
//
// Solo en desarrollo.

export const dynamic = "force-dynamic";

const RAIZ_PRUEBA = "ZZ probe-setup (borrar)";

/** Árbol de nombres de carpeta colgando de una raíz, ordenado y comparable. */
async function arbol(folderId, profundidad = 3) {
  if (profundidad === 0) return {};
  const res = await driveApi().files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const out = {};
  for (const f of (res.data.files || []).sort((a, b) => a.name.localeCompare(b.name))) {
    out[f.name] = await arbol(f.id, profundidad - 1);
  }
  return out;
}

/** El valor crudo de `driveFolders` en la hoja Config, para poder restaurarlo igual. */
async function driveFoldersCrudo() {
  const filas = await leerHoja(SHEETS.CONFIG, { crudo: true });
  for (const fila of filas) if (fila[0] === "driveFolders") return fila[1];
  return null;
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  const salida = {};
  // El respaldo se toma ANTES de tocar nada, y es el crudo de la celda: restaurar
  // pasando por JSON.parse + JSON.stringify podría cambiar el texto aunque el valor
  // sea el mismo.
  const respaldo = await driveFoldersCrudo();
  salida.respaldoTomado = respaldo != null;
  if (!respaldo) {
    return NextResponse.json(
      { error: "no hay driveFolders en Config: sin respaldo no se corre esta prueba" },
      { status: 412 },
    );
  }

  // Las raíces de juguete cuelgan de una carpeta configurada, que es donde la service
  // account tiene permiso. No se tocan sus contenidos.
  const base = (await getDriveFolders()).fotosPorCompletar;
  let raizPrueba = null;

  try {
    raizPrueba = await asegurarSubcarpetas(base, [RAIZ_PRUEBA]);
    const raizAs = await asegurarSubcarpetas(raizPrueba, ["appsScript"]);
    const raizSdk = await asegurarSubcarpetas(raizPrueba, ["sdk"]);

    const as = await appsScriptPost({ action: "setup", rootFolderId: raizAs }).catch((err) => ({
      error: err.message,
    }));
    const sdk = await SDK_POST.setup({ rootFolderId: raizSdk });

    salida.appsScript = as.error ? { error: as.error } : { claves: Object.keys(as.folders || {}) };
    salida.sdk = { claves: Object.keys(sdk.folders || {}), respuesta: sdk };

    const arbolAs = as.error ? null : await arbol(raizAs);
    const arbolSdk = await arbol(raizSdk);
    salida.arbolSdk = arbolSdk;

    // Idempotencia: segunda pasada sobre la MISMA raíz.
    const otraVez = await SDK_POST.setup({ rootFolderId: raizSdk });

    salida.veredicto = {
      mismasClaves: JSON.stringify(salida.appsScript.claves) === JSON.stringify(salida.sdk.claves),
      mismoArbol: JSON.stringify(arbolAs) === JSON.stringify(arbolSdk),
      // Los IDs de la segunda corrida tienen que ser exactamente los mismos.
      idempotente: JSON.stringify(otraVez.folders) === JSON.stringify(sdk.folders),
      // Y el árbol no puede haber crecido con carpetas duplicadas.
      sinDuplicados: JSON.stringify(await arbol(raizSdk)) === JSON.stringify(arbolSdk),
      proveedores: Object.keys(sdk.folders?.proveedores || {}).length,
      respaldos: Object.keys(sdk.folders?.medidorRespaldos || {}).length,
    };
    if (arbolAs) salida.arbolAppsScript = arbolAs;
  } catch (err) {
    salida.error = err.message;
  } finally {
    // Restaurar la config real es lo único que no puede fallar en silencio: la app
    // quedaría apuntando a las carpetas de juguete.
    try {
      await SDK_POST.setConfig({ key: "driveFolders", value: JSON.parse(respaldo) });
      const ahora = await driveFoldersCrudo();
      salida.configRestaurada = ahora === respaldo ? "sí, idéntica" : "RESTAURADA DISTINTA — revisar";
    } catch (err) {
      salida.configRestaurada = "FALLÓ LA RESTAURACIÓN: " + err.message + " — valor: " + respaldo;
    }
    if (raizPrueba) {
      try {
        await mandarAPapelera(raizPrueba);
        salida.limpieza = "carpetas de prueba a la papelera";
      } catch (err) {
        salida.limpieza = "QUEDÓ SIN BORRAR " + raizPrueba + ": " + err.message;
      }
    }
  }

  return NextResponse.json(salida);
}
