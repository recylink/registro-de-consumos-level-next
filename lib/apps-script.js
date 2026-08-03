import "server-only";
import { appsScriptUrl, isConfigured } from "./instance";
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
  if (usarSdk(action)) {
    // El SDK se llama directo, sin la caché de fetch de Next: no hay request HTTP
    // que cachear. Las lecturas por SDK son llamadas a la API de Sheets y el
    // `tag`/`revalidate` de acá no aplica — la invalidación por revalidateTag()
    // que hacen las mutaciones sigue sirviendo para las páginas, no para esto.
    return SDK_GET[action](params || {});
  }
  if (!isConfigured()) throw new BackendNotConfiguredError();
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
  if (!isConfigured()) throw new BackendNotConfiguredError();
  const res = await fetch(appsScriptUrl(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Apps Script HTTP " + res.status);
  return unwrap(await res.json());
}

// Versión del script desplegado en el /exec configurado. Sirve para verificar
// que el backend corre el código que se espera.
export async function ping() {
  return appsScriptGet({ action: "ping" }, { revalidate: 0 });
}

/**
 * Lectura forzada por el Apps Script, ignorando el flag. Sirve para dos cosas:
 * el ping del backend viejo en /api/health, y el diff de migración que compara
 * la salida de los dos backends para la misma action.
 */
export async function appsScriptGet(params, { revalidate = 0 } = {}) {
  if (!isConfigured()) throw new BackendNotConfiguredError();
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
