import "server-only";
import { apiGet, apiPost, TAGS } from "../apps-script";

// Store key/value de la hoja "Config". Los valores se guardan como JSON, así
// que admiten objetos y arreglos. Lo usan los IDs de carpetas de Drive
// (lib/drive-folders.js) y la lista de destinatarios de la cola de fotos.

export async function getConfigValue(key, { revalidate = 60 } = {}) {
  if (!key) return null;
  const data = await apiGet({ action: "getConfig", key }, { tag: TAGS.config, revalidate });
  return data ? data.value : null;
}

export async function setConfigValue(key, value) {
  if (!key) throw new Error("Falta la clave de config");
  await apiPost({ action: "setConfig", key, value });
}

/** Destinatarios del aviso "hay fotos por completar". */
export async function readFotoNotifEmails() {
  const v = await getConfigValue("fotoNotifEmails");
  return Array.isArray(v) ? v.filter((e) => typeof e === "string" && e.includes("@")) : [];
}

export async function writeFotoNotifEmails(emails) {
  const clean = (emails || [])
    .map((e) => String(e || "").trim())
    .filter((e) => e && e.includes("@"));
  await setConfigValue("fotoNotifEmails", clean);
}
