import "server-only";
import { unstable_cache } from "next/cache";
import { appsScriptConfigurado, appsScriptUrl } from "./instance";
import { usarSdk } from "./backend-flag";
import { SDK_GET, SDK_POST } from "./google/actions";

// Transporte hacia el backend. Durante la migración hay dos:
//
//   - Apps Script: un endpoint /exec público que multiplexa por `action`, GET
//     para lecturas y POST para mutaciones (ver apps-script.gs, doGet/doPost).
//   - SDK de Google APIs: la app le habla directo a Sheets y Drive con una
//     service account (ver lib/google/).
//
// `apiGet` y `apiPost` enrutan por action según RC_SDK_ACTIONS. Es a propósito
// que la decisión viva acá: los ocho módulos de lib/sheets/ y lib/drive*.js
// siguen llamando igual que antes y no se enteran del cambio, así que migrar una
// action no toca ningún consumidor.
//
// Cuando no quede ninguna action en el Apps Script, este archivo se reduce al
// router y conviene renombrarlo — hoy el nombre ya miente a medias.

// Etiquetas de caché. Cada lectura se marca con la suya para que las mutaciones
// puedan invalidar solo lo que corresponde vía revalidateTag().
export const TAGS = {
  records: "rc:records",
  sucursales: "rc:sucursales",
  emissions: "rc:emissions",
  medidores: "rc:medidores",
  fotos: "rc:fotos",
  config: "rc:config",
};

// Las lecturas por Apps Script se cachean solas: son `fetch` y Next cachea fetch
// con `next: { revalidate, tags }`. Las del SDK no pasan por fetch, así que sin
// esto perderían la caché — y con ella el techo de requests. La cuota de la API de
// Sheets es de 60 lecturas por minuto y por usuario: prerenderizar las 18 páginas
// del build la revienta, porque cada pantalla lee varias hojas.
//
// unstable_cache reproduce lo mismo que recibía fetch (mismo tag, mismo
// revalidate), así que la invalidación por revalidateTag() de las mutaciones sigue
// funcionando igual para los dos backends.
//
// Los envoltorios se memoizan por clave: unstable_cache devuelve una función y
// crear una nueva en cada llamada desperdicia el trabajo de indexado.
const cacheados = new Map();

function leerConCache(action, params, { tag, revalidate }) {
  const clave = action + ":" + JSON.stringify(params);
  let fn = cacheados.get(clave);
  if (!fn) {
    fn = unstable_cache(() => SDK_GET[action](params), [clave], {
      revalidate: revalidate === 0 ? 1 : revalidate,
      tags: tag ? [tag] : [],
    });
    cacheados.set(clave, fn);
  }
  return fn();
}

export class BackendNotConfiguredError extends Error {
  constructor() {
    super("Backend no configurado: falta APPS_SCRIPT_URL en el entorno.");
    this.name = "BackendNotConfiguredError";
  }
}

// El Apps Script responde 200 con `{ error }` en el cuerpo cuando algo falla —
// no usa códigos HTTP de error. Hay que revisar el payload siempre.
function unwrap(data) {
  if (data && data.error) throw new Error(String(data.error));
  return data;
}

/**
 * Lectura. `tag` marca la respuesta para invalidación selectiva; `revalidate`
 * en segundos acota cuánto puede quedar servida sin revalidar.
 */
export async function apiGet(params, { tag, revalidate = 30 } = {}) {
  const action = params && params.action;
  if (usarSdk(action)) return leerConCache(action, params || {}, { tag, revalidate });
  if (!appsScriptConfigurado()) throw new BackendNotConfiguredError();
  const qs = new URLSearchParams(
    Object.entries(params || {}).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await fetch(appsScriptUrl() + (qs ? "?" + qs : ""), {
    method: "GET",
    next: { revalidate, tags: tag ? [tag] : [] },
  });
  if (!res.ok) throw new Error("Apps Script HTTP " + res.status);
  return unwrap(await res.json());
}

/**
 * Mutación. Nunca se cachea. El Content-Type text/plain es deliberado: evita
 * el preflight CORS que Apps Script no responde. Se mantiene aunque acá la
 * llamada salga del servidor, porque el backend no cambia.
 */
export async function apiPost(body) {
  const action = body && body.action;
  if (usarSdk(action)) return SDK_POST[action](body || {});
  if (!appsScriptConfigurado()) throw new BackendNotConfiguredError();
  const res = await fetch(appsScriptUrl(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Apps Script HTTP " + res.status);
  return unwrap(await res.json());
}

export class SoloSdkError extends Error {
  constructor(action) {
    super(
      `La action "${action}" solo existe en el SDK: el Apps Script no tiene un ` +
        `equivalente. Agrégala a RC_SDK_ACTIONS (o usa "*") y vuelve a desplegar.`,
    );
    this.name = "SoloSdkError";
  }
}

/**
 * Mutación que NO tiene equivalente en el Apps Script.
 *
 * El router normal cae al /exec cuando una action no está habilitada por el flag.
 * Para las actions nuevas eso no sirve: el .gs respondería "unknown action", un
 * error del backend viejo que no dice nada del problema real —que es un env var
 * sin configurar—. Peor todavía en el caso de las `upsert*` de Medidores, cuyo
 * antecesor en el .gs (setSheetRows) sigue existiendo y hace clear+rewrite: un
 * fallback silencioso al /exec sería un camino de vuelta al clobber.
 *
 * Así que se corta acá, con un mensaje que nombra el env var. La misma doctrina de
 * `SdkHabilitadoSinCredencialesError`: un deploy mal configurado falla a la vista
 * en vez de funcionar en apariencia.
 */
export async function apiPostSoloSdk(body) {
  const action = body && body.action;
  if (!Object.hasOwn(SDK_POST, action || "")) {
    throw new Error(`Action no implementada en el SDK: "${action}".`);
  }
  if (!usarSdk(action)) throw new SoloSdkError(action);
  return SDK_POST[action](body || {});
}

// Versión del script desplegado en el /exec configurado. Sirve para verificar
// que el backend corre el código que se espera.
export async function ping() {
  return appsScriptGet({ action: "ping" }, { revalidate: 0 });
}

/**
 * Mutación forzada por el Apps Script, ignorando el flag. Solo la usa la
 * verificación de la migración, para escribir con el backend viejo y comparar
 * cómo quedó la celda contra lo que escribe el SDK.
 */
export async function appsScriptPost(body) {
  if (!appsScriptConfigurado()) throw new BackendNotConfiguredError();
  const res = await fetch(appsScriptUrl(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Apps Script HTTP " + res.status);
  return unwrap(await res.json());
}

/**
 * Lectura forzada por el Apps Script, ignorando el flag. Sirve para dos cosas:
 * el ping del backend viejo en /api/health, y el diff de migración que compara
 * la salida de los dos backends para la misma action.
 */
export async function appsScriptGet(params, { revalidate = 0 } = {}) {
  if (!appsScriptConfigurado()) throw new BackendNotConfiguredError();
  const qs = new URLSearchParams(
    Object.entries(params || {}).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await fetch(appsScriptUrl() + (qs ? "?" + qs : ""), {
    method: "GET",
    next: { revalidate, tags: [] },
  });
  if (!res.ok) throw new Error("Apps Script HTTP " + res.status);
  return unwrap(await res.json());
}
