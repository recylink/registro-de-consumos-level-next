import "server-only";
import { apiPost } from "./apps-script";

// Operaciones de Drive, todas vía Apps Script (corre con la cuenta dueña de la
// planilla, así la app no necesita login de Google).
//
// En el prototipo el navegador convertía el archivo a base64 a mano
// (String.fromCharCode + btoa por chunks de 32KB). Acá el File llega por
// FormData a un Server Action y Buffer hace la conversión.

/**
 * Sube un File a `folderId`. `subfolders` es una ruta relativa opcional que el
 * Apps Script crea si falta (ej: ["Medidor 1 (N° 123)", "2026-07"]).
 * Devuelve { id, link }.
 */
export async function uploadToDrive(file, folderId, subfolders = []) {
  if (!folderId) throw new Error("Carpeta de Drive no configurada.");
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return apiPost({
    action: "upload",
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    base64,
    folderId,
    subfolders: (subfolders || []).filter(Boolean),
  });
}

export async function moveInDrive(fileId, fromFolderId, toFolderId) {
  if (!fileId || !toFolderId) return;
  await apiPost({ action: "move", fileId, fromFolderId, toFolderId });
}

/** Manda el archivo a la papelera (recuperable 30 días por el dueño). */
export async function trashInDrive(fileId) {
  if (!fileId) return;
  await apiPost({ action: "deleteFile", fileId });
}

/**
 * Nombre de subcarpeta para respaldos de medidor. Los "/" y "\" romperían la
 * ruta, se reemplazan.
 */
export function meterFolderName(meter) {
  const base = (meter && meter.nombre) || "Medidor";
  const num = meter && meter.numero ? ` (N° ${meter.numero})` : "";
  return (base + num).replace(/[/\\]/g, "-").trim();
}
