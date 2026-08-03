import "server-only";
import { sheetsApi } from "./auth";
import { spreadsheetId } from "../instance";

// Helpers de bajo nivel sobre la API de Sheets v4, con la semántica EXACTA de
// sus equivalentes de Apps Script. Las diferencias son sutiles y silenciosas, así
// que van documentadas donde importan.

/**
 * Apps Script preguntaba `ss.getSheetByName(name)` y devolvía null si la hoja no
 * existía, y los getters respondían `[]`. La API de valores, en cambio, tira 400
 * "Unable to parse range" cuando el nombre no corresponde a ninguna hoja. Hay
 * que conocer los títulos antes de pedir valores.
 *
 * Se memoiza por unos segundos porque casi todas las lecturas necesitan esto y
 * la cuota por usuario de la API de Sheets es de 60 lecturas/minuto. Las
 * escrituras que crean hojas invalidan el caché a mano (ver invalidarHojas).
 */
let cacheHojas = null;
let cacheHojasVence = 0;
const TTL_HOJAS_MS = 5000;

export function invalidarHojas() {
  cacheHojas = null;
  cacheHojasVence = 0;
}

export async function hojas({ ahora = 0 } = {}) {
  const t = ahora || Date.now();
  if (cacheHojas && t < cacheHojasVence) return cacheHojas;
  const res = await sheetsApi().spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties(title,sheetId)",
  });
  cacheHojas = (res.data.sheets || []).map((s) => ({
    titulo: s.properties.title,
    sheetId: s.properties.sheetId,
  }));
  cacheHojasVence = t + TTL_HOJAS_MS;
  return cacheHojas;
}

export async function existeHoja(nombre) {
  return (await hojas()).some((h) => h.titulo === nombre);
}

export async function sheetIdDe(nombre) {
  const h = (await hojas()).find((x) => x.titulo === nombre);
  return h ? h.sheetId : null;
}

/**
 * Rellena las filas hasta el ancho de la más larga.
 *
 * `getDataRange().getValues()` de Apps Script devuelve una matriz rectangular:
 * toda fila llega con tantas celdas como columnas tenga el rango de datos. La
 * API de valores recorta las celdas vacías del final de cada fila, así que las
 * filas quedan de largos distintos.
 *
 * Sin este relleno, `records.js` (que lee con `row[col - 1]`, hasta la columna 12
 * en Agua) recibe `undefined` donde antes recibía `""`, y eso viaja hacia
 * `estadoValue` / `origenValue` sin que nada avise.
 */
export function rectangular(filas) {
  const ancho = filas.reduce((m, f) => Math.max(m, f.length), 0);
  return filas.map((f) => {
    const out = f.slice(0, ancho);
    while (out.length < ancho) out.push("");
    return out;
  });
}

/**
 * Todas las filas de una hoja, con encabezado, ya rectangulares.
 * Hoja inexistente → `[]`, como hacía Apps Script.
 *
 * `crudo` elige entre los dos modos de lectura que el script mezclaba, y hay que
 * respetarlo hoja por hoja:
 *   - `false` → FORMATTED_VALUE, equivale a `getDisplayValues()`. Devuelve lo que
 *     se ve en la celda: "20.440", "31-07-26". Es lo que esperan los parsers de
 *     lib/domain/parse.js.
 *   - `true` → UNFORMATTED_VALUE, equivale a `getValues()`. Devuelve el valor
 *     tipado: 20440, un serial de fecha.
 * Unificarlos rompe los parsers sin lanzar ningún error.
 */
export async function leerHoja(nombre, { crudo = false } = {}) {
  if (!(await existeHoja(nombre))) return [];
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    // El nombre a secas como rango = el rango de datos completo, igual que
    // getDataRange(). Va entre comillas simples por los nombres con espacios
    // ("Lecturas Medidor") y se escapan las comillas internas.
    range: `'${nombre.replace(/'/g, "''")}'`,
    valueRenderOption: crudo ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return rectangular(res.data.values || []);
}

/** Filas de datos, sin el encabezado. Equivale a `data.slice(1)` del script. */
export async function leerFilas(nombre, opts) {
  const todo = await leerHoja(nombre, opts);
  return todo.slice(1);
}

/**
 * Varias hojas en un solo request. `readAll` leía tres hojas con tres llamadas;
 * batchGet las trae juntas. Las que no existen no se piden y salen como `[]`.
 */
export async function leerVariasHojas(nombres, { crudo = false } = {}) {
  const presentes = new Set((await hojas()).map((h) => h.titulo));
  const pedir = nombres.filter((n) => presentes.has(n));
  const out = {};
  for (const n of nombres) out[n] = [];
  if (!pedir.length) return out;

  const res = await sheetsApi().spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId(),
    ranges: pedir.map((n) => `'${n.replace(/'/g, "''")}'`),
    valueRenderOption: crudo ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  // batchGet devuelve los rangos en el orden pedido.
  (res.data.valueRanges || []).forEach((vr, i) => {
    out[pedir[i]] = rectangular(vr.values || []);
  });
  return out;
}
