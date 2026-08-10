import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/apps-script";
import { SDK_POST } from "@/lib/google/actions";
import { SHEETS, isSdkConfigured, sdkFaltantes, spreadsheetId } from "@/lib/instance";
import { invalidarHojas, leerHoja } from "@/lib/google/sheets-api";

// Provisión de una instancia: crea las hojas y el árbol de ~25 carpetas de Drive bajo
// UNA carpeta raíz, y deja los IDs en la clave `driveFolders` de la hoja "Config".
//
//   curl -s  http://localhost:3000/api/migracion/setup                        # informe
//   curl -s -X POST 'http://localhost:3000/api/migracion/setup?rootFolderId=<ID>'
//   curl -s -X POST 'http://localhost:3000/api/migracion/setup?rootFolderId=<ID>&forzar=si'
//
// POR QUÉ EXISTE
//
// Esto lo hacía la acción `setup` del Apps Script, invocada por curl contra el /exec.
// Se retiró en v6, y era la más peligrosa de las que quedaban: el endpoint es público
// y sin autenticación, así que cualquiera con la URL podía correr `setup` apuntando a
// una carpeta propia y la app habría empezado a subir los documentos de la empresa
// ahí. La provisión es una operación de una vez por instancia, hecha por una persona
// con las credenciales en la mano; no tiene por qué vivir en un endpoint abierto.
//
// La traducción al SDK es `setup` en lib/google/actions.js, verificada contra la
// función original con /api/migracion/probe-setup (mismas claves, mismo árbol de
// nombres, idempotente).
//
// SOLO EN DESARROLLO, igual que el resto de /api/migracion/. Se corre desde local
// contra la planilla real, con las credenciales de `.env.local` — es exactamente el
// mismo camino que usaría el deploy, porque la service account es la misma. Y en el
// deploy la única protección sería `SITE_PASSWORD`, que es una contraseña compartida
// (o ninguna, si no está configurada).
//
// EL RIESGO QUE HAY QUE CUIDAR, Y CÓMO
//
// `setup` es idempotente sobre la MISMA raíz: cada carpeta se busca por nombre antes
// de crearse, así que correrlo de nuevo devuelve los mismos IDs. Es lo que se hace al
// agregar un proveedor. Pero sobre OTRA raíz no falla ni avisa: crea un árbol nuevo y
// reescribe `driveFolders` con esos IDs. La app quedaría subiendo a las carpetas
// nuevas y los adjuntos viejos, inalcanzables — sin ningún error a la vista.
//
// Por eso, si ya hay `driveFolders`, el POST exige `?forzar=si`, y la respuesta trae
// `cambios`: las claves cuyo ID quedó distinto al de antes. Sobre la raíz correcta esa
// lista tiene solo lo que se acaba de crear; si trae todo, se apuntó a la raíz
// equivocada y el valor anterior está en `antes` para volver atrás.

export const dynamic = "force-dynamic";

const CLAVE = "driveFolders";

function soloDesarrollo() {
  if (process.env.NODE_ENV !== "production") return null;
  return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
}

/** El crudo de la celda, no el JSON parseado: es lo que se pega de vuelta si hay que volver. */
async function driveFoldersCrudo() {
  const filas = await leerHoja(SHEETS.CONFIG, { crudo: true }).catch(() => []);
  for (const fila of filas) if (fila[0] === CLAVE) return fila[1];
  return null;
}

function parsear(crudo) {
  if (!crudo) return null;
  try {
    return JSON.parse(crudo);
  } catch {
    return null;
  }
}

/**
 * Claves cuyo ID cambió, aplanadas: "proveedores.enel.porProcesar" en vez de un
 * objeto anidado. Sobre la raíz correcta la lista es corta y se lee de un vistazo.
 */
function diferencias(antes, despues, prefijo = "") {
  const out = [];
  for (const [clave, valor] of Object.entries(despues || {})) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    const previo = (antes || {})[clave];
    if (valor && typeof valor === "object") {
      out.push(...diferencias(previo, valor, ruta));
    } else if (previo !== valor) {
      out.push({ clave: ruta, antes: previo ?? null, ahora: valor });
    }
  }
  return out;
}

export async function GET() {
  const bloqueo = soloDesarrollo();
  if (bloqueo) return bloqueo;

  const crudo = await driveFoldersCrudo();
  const actual = parsear(crudo);

  return NextResponse.json({
    sdk: isSdkConfigured() ? "configurado" : `faltan: ${sdkFaltantes().join(", ")}`,
    spreadsheetId: spreadsheetId() || null,
    provisionada: actual != null,
    claves: actual ? Object.keys(actual) : [],
    proveedores: Object.keys(actual?.proveedores || {}),
    respaldos: Object.keys(actual?.medidorRespaldos || {}),
    // Los IDs completos no se listan acá: el informe es para saber si hay que correr
    // el POST, y con `?forzar=si` la respuesta del POST ya trae el valor anterior.
    comoCorrer:
      "POST ?rootFolderId=<ID de la carpeta raíz de Drive>" +
      (actual ? "&forzar=si (ya hay driveFolders: ver el aviso del código)" : ""),
  });
}

export async function POST(request) {
  const bloqueo = soloDesarrollo();
  if (bloqueo) return bloqueo;

  if (!isSdkConfigured()) {
    return NextResponse.json(
      { error: `SDK no configurado, faltan: ${sdkFaltantes().join(", ")}` },
      { status: 412 },
    );
  }

  const params = new URL(request.url).searchParams;
  const rootFolderId = (params.get("rootFolderId") || "").trim();
  if (!rootFolderId) {
    return NextResponse.json(
      { error: "falta ?rootFolderId=<ID de la carpeta raíz de Drive>" },
      { status: 400 },
    );
  }

  // El respaldo se toma ANTES de escribir nada, y crudo: si hay que volver atrás se
  // pega este texto tal cual en la celda.
  const crudoAntes = await driveFoldersCrudo();
  const antes = parsear(crudoAntes);

  if (antes && params.get("forzar") !== "si") {
    return NextResponse.json(
      {
        error:
          "esta instancia ya tiene driveFolders. Correr setup sobre OTRA raíz " +
          "reescribe el mapa y deja los adjuntos viejos inalcanzables. Si la raíz " +
          "es la correcta, repetir con &forzar=si.",
        clavesActuales: Object.keys(antes),
      },
      { status: 409 },
    );
  }

  let respuesta;
  try {
    respuesta = await SDK_POST.setup({ rootFolderId });
  } catch (err) {
    // `driveFolders` se escribe al final de `setup`, así que un fallo creando
    // carpetas deja la config anterior intacta. Se dice, porque es la primera
    // pregunta al ver el error.
    return NextResponse.json(
      { error: err.message, configAnteriorIntacta: true, antes: crudoAntes },
      { status: 500 },
    );
  }

  // `getDriveFolders` (lib/drive-folders.js) lee por `getConfig` y se cachea 300s con
  // la etiqueta de config. Sin invalidar, la app seguiría usando el mapa viejo.
  invalidarHojas();
  revalidateTag(TAGS.config);

  const cambios = diferencias(antes, respuesta.folders);

  return NextResponse.json({
    ok: true,
    rootFolder: respuesta.rootFolder,
    spreadsheetUrl: respuesta.spreadsheetUrl,
    folders: respuesta.folders,
    primeraVez: antes == null,
    cambios,
    // Solo cuando había algo que reemplazar, y crudo para poder restaurarlo igual.
    antes: antes ? crudoAntes : undefined,
  });
}
