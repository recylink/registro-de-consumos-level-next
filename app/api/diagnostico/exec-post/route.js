import { NextResponse } from "next/server";
import { appsScriptConfigurado, appsScriptUrl } from "@/lib/instance";
import { getDriveFolders, medidorFolder } from "@/lib/drive-folders";
import { trashInDrive, uploadToDrive } from "@/lib/drive";

// ¿Le llega el cuerpo al Apps Script cuando el POST sale del runtime de Vercel?
//
//   curl -s https://<deploy>/api/diagnostico/exec-post -b "rc_acceso=<token>"
//
// EL SÍNTOMA
//
// En producción, subir un adjunto en Medidores falla con "action retirada de este
// backend: (ninguna)". El `(ninguna)` no es una action que se haya retirado: es lo
// que imprime el .gs cuando `JSON.parse(e.postData.contents || "{}")` da `{}`, o
// sea cuando el cuerpo llegó VACÍO (ver doPost en apps-script.gs). El POST sale de
// Vercel, pero el cuerpo no cruza. Local funciona: probado con espía sobre `fetch`,
// y `upload` probada contra el /exec real con 8 bytes y con 1 MB.
//
// POR QUÉ `ping` DISCRIMINA
//
// `ping` está en ACTIONS_ACTIVAS pero NO tiene rama en doPost. Entonces:
//
//   cuerpo que llega  → "unknown action: ping"        (pasó la lista blanca)
//   cuerpo vacío      → "action retirada: (ninguna)"  (el síntoma del bug)
//
// Dos respuestas distintas y ninguna toca Drive ni la planilla. Por eso esta ruta
// SÍ existe en producción, al revés que /api/diagnostico/drive y /api/migracion/*:
// el bug solo se reproduce ahí, y acá no hay nada que se pueda romper. Queda detrás
// del muro de `SITE_PASSWORD` como cualquier ruta no listada en proxy.js.
//
// LAS VARIANTES
//
// La hipótesis es que el runtime manda el POST en chunked, sin `Content-Length`, y
// Apps Script lo recibe vacío — el `411 Length Required` visto desde el servidor.
// Las variantes están para que la respuesta no sea solo "falla" sino "falla así":
// si `tal-cual` da (ninguna) y `content-length` da unknown action, el arreglo es
// una línea en apiPost. Si fallan las cuatro, el cuerpo se pierde antes y hay que
// mirar más abajo. Si no falla ninguna, el problema es del tamaño y lo dice `grande`.

export const dynamic = "force-dynamic";

const URL_PING = { action: "ping" };

/** Qué dice la respuesta del .gs sobre el cuerpo que recibió. */
function interpretar(texto) {
  if (/unknown action: ping/.test(texto)) return "EL CUERPO LLEGÓ";
  if (/\(ninguna\)/.test(texto)) return "CUERPO VACÍO — es el bug";
  return "otra respuesta, leerla";
}

/**
 * Dónde terminó el request. Un POST al /exec siempre contesta 302 a
 * script.googleusercontent.com/…/echo?user_content_key=… y ahí vive la respuesta;
 * `fetch` sigue el redirect como GET y sin cuerpo, que es correcto porque la
 * respuesta ya está materializada del otro lado. Pero si el 302 apunta de vuelta al
 * propio /exec, ese GET sin querystring cae en doGet SIN action — y doGet imprime el
 * mismo "(ninguna)" que doPost. El síntoma sería idéntico y la causa, otra. Por eso
 * se mira el host final y no solo el cuerpo.
 */
function destino(url) {
  try {
    const u = new URL(url);
    // El user_content_key es un token de un solo uso; no hace falta en el informe.
    return u.host + u.pathname;
  } catch {
    return url;
  }
}

async function probar(nombre, init) {
  const t0 = process.hrtime.bigint();
  try {
    const res = await fetch(appsScriptUrl(), { cache: "no-store", method: "POST", ...init });
    const texto = await res.text();
    return {
      variante: nombre,
      status: res.status,
      // El .gs responde 200 con { error } en el cuerpo, así que el texto es el dato.
      respuesta: texto.slice(0, 300),
      veredicto: interpretar(texto),
      redirigido: res.redirected,
      destino: destino(res.url),
      ms: Number((process.hrtime.bigint() - t0) / 1000000n),
    };
  } catch (err) {
    return { variante: nombre, error: err.message, causa: err.cause?.message ?? null };
  }
}

/** POST de `mb` megabytes con action ping. El relleno no lo lee nadie. */
function deTamaño(mb) {
  return JSON.stringify({ ...URL_PING, relleno: "x".repeat(mb * 1024 * 1024) });
}

/**
 * El camino real, no una imitación: las mismas funciones que corre el Server
 * Action que falla (`uploadMedidorDocAction` → getDriveFolders → medidorFolder →
 * uploadToDrive → apiPost). Las variantes de arriba prueban el transporte; esto
 * prueba la cadena entera, que es donde ya no quedan sospechosos.
 *
 * Escribe en Drive, así que va detrás de `?upload=si` y se limpia sola: sube 12
 * bytes con un nombre que se reconoce a simple vista y después los manda a la
 * papelera con `trashInDrive`, la misma función que usa el botón de borrar. Si la
 * limpieza falla, el informe dice qué archivo quedó.
 */
async function probarSubidaReal() {
  const paso = {};
  try {
    const folders = await getDriveFolders();
    const folderId = medidorFolder(folders, "factura", null);
    paso.carpeta = folderId ? "medidorFacturas configurada" : "SIN carpeta configurada";
    if (!folderId) return paso;

    const file = new File(["diagnostico"], "ZZ diagnostico (borrar).txt", { type: "text/plain" });
    const up = await uploadToDrive(file, folderId);
    paso.subida = { ok: true, fileId: up.id };

    try {
      await trashInDrive(up.id);
      paso.limpieza = "a la papelera";
    } catch (err) {
      paso.limpieza = "NO se pudo borrar " + up.id + ": " + err.message;
    }
  } catch (err) {
    // El mensaje es el dato: "(ninguna)" acá es el bug reproducido en el runtime.
    paso.subida = { ok: false, error: err.message };
  }
  return paso;
}

export async function GET(request) {
  if (!appsScriptConfigurado()) {
    return NextResponse.json({ error: "APPS_SCRIPT_URL no configurada" }, { status: 503 });
  }

  const cuerpo = JSON.stringify(URL_PING);
  const bytes = new TextEncoder().encode(cuerpo);

  const pruebas = [
    // Copia exacta de lo que hace apiPost hoy (lib/apps-script.js). El text/plain
    // viene de evitar el preflight CORS que Apps Script no responde.
    ["tal-cual", { headers: { "Content-Type": "text/plain;charset=utf-8" }, body: cuerpo }],
    // La hipótesis, directa: declarar el largo en vez de dejar que salga chunked.
    [
      "content-length",
      {
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
          "Content-Length": String(bytes.byteLength),
        },
        body: cuerpo,
      },
    ],
    // Un cuerpo binario tiene largo conocido, así que undici puede poner el header
    // solo. Discrimina si el problema es el string o la falta del header.
    ["uint8array", { headers: { "Content-Type": "text/plain;charset=utf-8" }, body: bytes }],
  ];

  // Escalera de tamaños. 1 MB ya se probó y pasa, así que lo que falta medir es más
  // arriba: una factura escaneada o una foto de celular pesan varios MB, y el POST
  // de `upload` la lleva entera en base64 (+33% sobre el archivo). Si hay un techo,
  // acá aparece — y en qué escalón aparece dice cuál es.
  for (const mb of [1, 3, 5, 8]) {
    pruebas.push([
      `grande-${mb}mb`,
      { headers: { "Content-Type": "text/plain;charset=utf-8" }, body: deTamaño(mb) },
    ]);
  }

  const resultados = [];
  for (const [nombre, init] of pruebas) resultados.push(await probar(nombre, init));

  const llegó = resultados.filter((r) => r.veredicto === "EL CUERPO LLEGÓ").map((r) => r.variante);
  const vacío = resultados.filter((r) => /CUERPO VACÍO/.test(r.veredicto || "")).map((r) => r.variante);

  const subidaReal =
    request.nextUrl.searchParams.get("upload") === "si"
      ? await probarSubidaReal()
      : "no pedida (agregar ?upload=si)";

  return NextResponse.json({
    entorno: {
      // Sin esto no se sabe si lo que se está midiendo es producción o local.
      vercel: process.env.VERCEL === "1",
      entorno: process.env.VERCEL_ENV ?? "local",
      region: process.env.VERCEL_REGION ?? null,
      node: process.version,
      deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    },
    resultados,
    subidaReal,
    veredicto:
      llegó.length === resultados.length
        ? "el cuerpo llega SIEMPRE: el bug de upload no es el transporte, buscar en lib/drive.js"
        : vacío.length === resultados.length
          ? "el cuerpo NO llega en ninguna variante: se pierde antes del header, Content-Length no lo arregla"
          : llegó.length
            ? "llega solo con: " + llegó.join(", ") + " — esa es la diferencia que arregla apiPost"
            : "ninguna variante respondió como se esperaba: leer `respuesta` una por una",
  });
}
