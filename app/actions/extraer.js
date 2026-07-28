"use server";

import { run } from "@/lib/result";
import { extraer } from "@/lib/extractores";

/**
 * Extrae filas de un documento de proveedor.
 *
 * En el prototipo esto corría en el navegador: pdf.js y xlsx llegaban por CDN y
 * el parsing ocupaba el hilo principal de la pestaña. Acá el archivo viaja al
 * servidor, se parsea allá y vuelven las filas ya armadas. El navegador no
 * descarga ninguna librería de parsing.
 *
 * Los archivos se procesan de a uno para poder reportar el error del que falla
 * sin perder los que sí se leyeron.
 */
export async function extraerDocumentoAction(formData) {
  return run(async () => {
    const file = formData.get("file");
    if (!file || typeof file === "string") throw new Error("Falta el archivo");
    const provider = JSON.parse(formData.get("provider") || "{}");
    const rows = await extraer(file, provider);
    return { rows };
  });
}
