import "server-only";
import { appsScriptUrl, isConfigured } from "./instance";

// Transporte contra el Apps Script desplegado como aplicación web. Un solo
// endpoint /exec multiplexa por `action`: GET para lecturas, POST para
// mutaciones (ver apps-script.gs, doGet/doPost).

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
  return apiGet({ action: "ping" }, { revalidate: 0 });
}
