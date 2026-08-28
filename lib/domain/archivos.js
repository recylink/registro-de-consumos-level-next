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

// ----- Validación en el servidor -------------------------------------------
//
// Todo lo de arriba se valida en el cliente, antes de enviar, para dar un mensaje
// legible en vez de un 500 opaco. Eso NO es un límite: un cliente que no sea el
// navegador de la app —`curl`— lo ignora entero. Lo de acá lo aplica lib/drive.js
// en el servidor, que es por donde pasan las cuatro rutas de subida.

/** Lo que la app acepta como adjunto. Todo lo demás se rechaza. */
export const MIME_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic", // fotos de iPhone sin convertir
  "image/tiff", // salida de algunos escáneres
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

/**
 * Tipo real del archivo, por sus primeros bytes. El `file.type` que llega del
 * navegador lo declara el cliente y no se verifica contra nada: un .html o un
 * .svg puede presentarse como "application/pdf", entrar al Drive de la empresa y
 * salir por correo como si fuera una factura.
 *
 * Devuelve null si no reconoce la firma — y no reconocer significa rechazar.
 * Es deliberado que SVG no esté: es XML de texto, no tiene firma binaria, y es
 * el formato de imagen que ejecuta scripts.
 */
export function tipoRealDe(bytes) {
  const b = new Uint8Array(bytes).subarray(0, 16);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const texto = (i, n) => String.fromCharCode(...b.subarray(i, i + n));

  if (hex.startsWith("25504446")) return "application/pdf"; // %PDF
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (texto(0, 4) === "RIFF" && texto(8, 4) === "WEBP") return "image/webp";
  if (texto(4, 4) === "ftyp") return "image/heic"; // contenedor ISO-BMFF
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a")) return "image/tiff";
  // Un .xlsx es un zip; un .xls es un contenedor OLE2.
  if (hex.startsWith("504b0304")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (hex.startsWith("d0cf11e0")) return "application/vnd.ms-excel";
  return null;
}

/**
 * Nombre seguro para Drive: sin separadores de ruta, sin caracteres de control y
 * de largo acotado. `meterFolderName` ya limpiaba el nombre de la subcarpeta
 * (lib/drive.js), pero el del archivo pasaba entero.
 */
export function nombreSeguro(nombre) {
  const limpio = String(nombre || "")
    .replace(/[/\\]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .slice(0, 200)
    .trim();
  return limpio || "adjunto";
}
