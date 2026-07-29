// Límites de tamaño de los adjuntos. Isomorfo y sin dependencias: lo importan
// los componentes de cliente, los Server Actions y next.config.mjs (que fija el
// límite de cuerpo de los Server Actions con el mismo número).
//
// Por qué existe: los archivos viajan a los Server Actions dentro de un
// FormData, y Next corta el cuerpo en 1 MB por defecto. Al pasarse, el request
// muere con un 500 y el navegador solo ve "An error occurred in the Server
// Components render" — sin mensaje útil. Un lote de dos facturas escaneadas ya
// superaba ese límite, así que registrar más de un consumo con adjuntos fallaba
// siempre. Acá se sube el límite y además se valida antes de enviar, para que un
// lote demasiado grande dé un mensaje legible en vez de un 500 opaco.

/** Tope por archivo individual. */
export const MAX_ARCHIVO_BYTES = 15 * 1024 * 1024;

/** Tope de la suma de adjuntos de un mismo envío (un lote, una cola). */
export const MAX_LOTE_BYTES = 20 * 1024 * 1024;

/**
 * Límite de cuerpo de los Server Actions. Deja holgura sobre MAX_LOTE_BYTES
 * para el resto del FormData (JSON de registros y overhead del multipart).
 */
export const BODY_SIZE_LIMIT = "25mb";

export function tamanoLegible(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mensaje de error si el archivo excede el tope, o null si está bien. */
export function errorArchivo(file) {
  if (!file) return null;
  if (file.size > MAX_ARCHIVO_BYTES) {
    return `${file.name} pesa ${tamanoLegible(file.size)} y el máximo por archivo es ${tamanoLegible(MAX_ARCHIVO_BYTES)}.`;
  }
  return null;
}

/** Mensaje de error si la suma de los archivos excede el tope, o null. */
export function errorLote(files) {
  const lista = (files || []).filter(Boolean);
  const total = lista.reduce((a, f) => a + (f.size || 0), 0);
  if (total > MAX_LOTE_BYTES) {
    return `Los ${lista.length} adjuntos suman ${tamanoLegible(total)} y el máximo por envío es ${tamanoLegible(MAX_LOTE_BYTES)}. Quita o comprime alguno.`;
  }
  return null;
}
