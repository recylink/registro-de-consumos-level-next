"use server";

import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/apps-script";
import { run } from "@/lib/result";
import { writeMedidores } from "@/lib/sheets/medidores";
import { getDriveFolders, medidorFolder } from "@/lib/drive-folders";
import { meterFolderName, trashInDrive, uploadToDrive } from "@/lib/drive";
import { loadRecords } from "@/lib/data";
import { medidoresWorkbook } from "@/lib/reportes/medidores-excel";

/** Guarda medidores, lecturas y precios (reescritura de las tres hojas). */
export async function saveMedidoresAction(M) {
  return run(async () => {
    await writeMedidores(M);
    revalidateTag(TAGS.medidores);
    return {};
  });
}

/**
 * Sube un documento de medidor. `kind` es "factura" | "pago" | "respaldo".
 * Los respaldos se ordenan en subcarpetas <medidor>/<mes> dentro de la carpeta
 * del tipo de consumo; el Apps Script las crea si faltan.
 */
export async function uploadMedidorDocAction(formData) {
  return run(async () => {
    const file = formData.get("file");
    if (!file || typeof file === "string") throw new Error("Falta el archivo");
    const kind = formData.get("kind") || "factura";
    const month = formData.get("month") || "";
    const meter = JSON.parse(formData.get("meter") || "null");

    const folders = await getDriveFolders();
    const folderId = medidorFolder(folders, kind, meter && meter.type);
    if (!folderId) throw new Error(`Carpeta de Drive no configurada para "${kind}".`);

    const subfolders = kind === "respaldo" && meter ? [meterFolderName(meter), month] : [];
    const up = await uploadToDrive(file, folderId, subfolders);
    revalidateTag(TAGS.medidores);
    return { doc: { fileId: up.id, link: up.link, name: file.name } };
  });
}

/** Manda el archivo a la papelera de Drive. La fila se limpia por separado. */
export async function deleteMedidorDocAction(fileId) {
  return run(async () => {
    await trashInDrive(fileId);
    revalidateTag(TAGS.medidores);
    return {};
  });
}

/**
 * Arma el Excel del módulo y lo devuelve en base64.
 *
 * El módulo (`M`) llega del cliente y no se lee de la planilla a propósito: la
 * pantalla guarda con debounce, así que exportar justo después de escribir una
 * lectura tomaría el valor viejo. Los registros globales sí salen del servidor,
 * porque esta pantalla no los edita.
 */
export async function exportMedidoresExcelAction({ M, sucursal, tipo, meses }) {
  return run(async () => {
    const records = await loadRecords();
    return medidoresWorkbook({ M, records: records.data, sucursal, tipo, meses });
  });
}
