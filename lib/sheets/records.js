import "server-only";
import { apiGet, apiPost, apiPostSoloSdk, TAGS } from "../apps-script";
import { EMPRESA, SHEETS } from "../instance";
import { subcatLabel } from "../domain/catalog";
import { nextConsumoId } from "../domain/ids";
import { ENCABEZADOS } from "../google/headers";
import { exigirEncabezado } from "./encabezados";
import {
  parseDate,
  toNumber,
  combSubcatFromLabel,
  aguaSubcatFromLabel,
  estadoLabel,
  estadoValue,
  origenLabel,
  origenValue,
  endOfMonth,
  fmtDDMMYY,
} from "../domain/parse";

// Registros de consumo: hojas Combustible / Electricidad / Agua.
//
// El prototipo tenía las posiciones de columna repetidas en tres lugares
// (lectura por índice en rcReadAllRecords, escritura por posición en
// rowsByType, y una tabla aparte en rcResolveSheetCell). Acá hay una sola
// tabla: `LAYOUT`. Los números son columnas 1-based, igual que las usa el
// Apps Script al actualizar celdas.

// La columna `id` va última en las tres, y es la razón: una hoja no tiene clave
// primaria, así que hasta ahora la identidad de un registro era su POSICIÓN
// (`comb-12` = la fila 14). Cualquiera que ordene o borre una fila desde la
// planilla invalida esa identidad, y escribir en la fila equivocada no produce
// ningún error — solo un dato mal puesto.
//
// En una planilla existente la columna la agrega /api/migracion/columna-id. Hasta
// que eso corra, `cols.id` apunta a una columna que no existe: `toRecord` lo detecta
// y vuelve al id posicional, así que el comportamiento es el de antes.
const LAYOUT = {
  combustible: {
    sheet: SHEETS.COMBUSTIBLE,
    idPrefix: "comb",
    width: 11,
    cols: {
      link: 1, date: 2, cantidad: 3, costo: 4, empresa: 5,
      sucursal: 6, subcat: 7, provider: 8, estado: 9, origen: 10, id: 11,
    },
  },
  electricidad: {
    sheet: SHEETS.ELECTRICIDAD,
    idPrefix: "elec",
    width: 12,
    cols: {
      link: 1, numeroCliente: 2, date: 3, cantidad: 4, costo: 5, empresa: 6,
      sucursal: 7, tipoLabel: 8, provider: 9, estado: 10, origen: 11, id: 12,
    },
  },
  agua: {
    sheet: SHEETS.AGUA,
    idPrefix: "agua",
    width: 13,
    cols: {
      link: 1, numeroCliente: 2, date: 3, cantidad: 4, costo: 5, empresa: 6,
      sucursal: 7, tipoLabel: 8, provider: 9, subcat: 10, estado: 11, origen: 12,
      id: 13,
    },
  },
};

/** Las tres hojas con su columna ID y el ancho que espera la app. */
export const LAYOUT_REGISTROS = Object.entries(LAYOUT).map(([type, l]) => ({
  type,
  sheet: l.sheet,
  idPrefix: l.idPrefix,
  colId: l.cols.id,
  width: l.width,
}));

const BY_PREFIX = Object.fromEntries(
  Object.entries(LAYOUT).map(([type, l]) => [l.idPrefix, { type, ...l }]),
);

// Etiquetas fijas de la columna "Tipo de consumo". Las escribe la app y las leen
// personas y filtros del Sheet — no cambiar sin migrar las filas existentes.
const TIPO_LABEL = { electricidad: "⚡Energía kWh", agua: "💧Agua m3" };

// Defaults históricos de la planilla para filas sin dato.
const DEFAULT_PROVIDER = { electricidad: "Enel", agua: "Aguas Andinas" };
const DEFAULT_COMB_TIPO = "Petróleo Diesel";

const at = (row, col) => row[col - 1];

/** Unidad de un registro de combustible según su subcategoría. */
function combUnit(subcat) {
  return subcat === "glp" || subcat === "gas-natural" ? "kg" : "L";
}

function toRecord(type, row, i) {
  const { cols, sheet, idPrefix } = LAYOUT[type];
  const fecha = at(row, cols.date);
  const consumo = at(row, cols.cantidad);
  // Filas totalmente vacías (o de relleno) se descartan.
  if (!fecha && !consumo) return null;

  const subcat =
    type === "combustible"
      ? combSubcatFromLabel(at(row, cols.subcat))
      : type === "agua"
        ? aguaSubcatFromLabel(at(row, cols.subcat))
        : null;

  // Identidad: la columna ID si la fila la tiene, y si no la posición. El id
  // posicional lleva guion medio (`comb-12`) y el real guion bajo (`comb_lz3...`),
  // así que `updateRecordField` distingue uno de otro sin ambigüedad.
  const idHoja = String(at(row, cols.id) ?? "").trim();

  const rec = {
    id: idHoja || `${idPrefix}-${i}`,
    _porPosicion: !idHoja,
    _sheetName: sheet,
    // Fila 1 es el encabezado, así que el índice 0 de datos es la fila 2.
    _sheetRow: i + 2,
    _estadoCol: cols.estado,
    date: parseDate(fecha),
    sucursal: at(row, cols.sucursal) || "",
    type,
    subcat,
    provider: at(row, cols.provider) || "",
    cantidad: toNumber(consumo),
    unit: type === "combustible" ? combUnit(subcat) : type === "agua" ? "m³" : "kWh",
    costo: toNumber(at(row, cols.costo)),
    origen: origenValue(at(row, cols.origen)),
    estado: estadoValue(at(row, cols.estado)),
    _driveLink: at(row, cols.link) || "",
  };
  if (cols.numeroCliente) rec.numeroCliente = at(row, cols.numeroCliente) || "";
  return rec;
}

/**
 * Lee las tres hojas de consumo y las aplana en una sola lista de Registros.
 * Sin backend configurado devuelve [] en vez de fallar: es el modo local.
 */
export async function readRecords() {
  const data = await apiGet({ action: "read" }, { tag: TAGS.records, revalidate: 15 });
  const records = [];
  for (const [type, layout] of Object.entries(LAYOUT)) {
    const filas = data[layout.sheet] || [];
    // Antes de leer nada por posición, comprobar que la posición signifique lo que
    // la app cree. Si alguien movió una columna, esto corta con un mensaje que dice
    // cuál — la alternativa es leer costos como consumos y no enterarse.
    exigirEncabezado(layout.sheet, filas[0], ENCABEZADOS[layout.sheet], {
      opcionales: ["ID"],
    });
    const rows = filas.slice(1); // saltar encabezado
    rows.forEach((row, i) => {
      const rec = toRecord(type, row, i);
      if (rec) records.push(rec);
    });
  }
  return records;
}

/**
 * Registro del dominio → fila del Sheet, en el orden de su hoja.
 *
 * `conId` decide si la fila incluye la columna ID. Con la columna todavía sin crear,
 * escribirla sería escribir más allá del encabezado —y de la grilla, que responde
 * 400 "exceeds grid limits"—, así que la fila sale con el ancho de antes. La columna
 * ID es la última de las tres hojas, por eso alcanza con recortar el ancho.
 */
function toRow(rec, conId) {
  const layout = LAYOUT[rec.type];
  if (!layout) return null;
  const { cols, width, idPrefix } = layout;
  const isManual = rec.origen === "manual";
  const row = new Array(conId ? width : width - 1).fill("");
  const put = (col, value) => {
    if (col && col <= row.length) row[col - 1] = value;
  };

  // El id lo acuña el servidor al escribir, no el cliente: `rec.id` es un id de
  // interfaz (`r_...`), sin el prefijo que dice en qué hoja vive la fila.
  if (conId) put(cols.id, nextConsumoId(idPrefix));

  put(cols.link, rec._driveLink || "");
  // Los manuales guardan el día que eligió el usuario (DD-MM-YY); los extraídos
  // de documento, el cierre del período.
  put(cols.date, isManual ? fmtDDMMYY(rec.date) : rec.type === "combustible" ? endOfMonth(rec.date) : rec.date);
  put(cols.cantidad, rec.cantidad);
  put(cols.costo, rec.costo);
  put(cols.empresa, EMPRESA);
  put(cols.sucursal, rec.sucursal);
  put(cols.numeroCliente, rec.numeroCliente || "");
  put(cols.tipoLabel, TIPO_LABEL[rec.type] || "");
  put(cols.provider, rec.provider || DEFAULT_PROVIDER[rec.type] || "");
  put(cols.estado, estadoLabel(rec.estado));
  put(cols.origen, origenLabel(rec.origen));
  if (cols.subcat) {
    const label = rec.subcat ? subcatLabel(rec.type, rec.subcat) : "";
    put(cols.subcat, label || (rec.type === "combustible" ? DEFAULT_COMB_TIPO : ""));
  }
  return row;
}

/** Agrupa registros por hoja destino. */
export function rowsBySheet(records, conId) {
  const out = {};
  for (const rec of records || []) {
    const layout = LAYOUT[rec.type];
    const row = toRow(rec, conId);
    if (!layout || !row) continue;
    (out[layout.sheet] ||= []).push(row);
  }
  return out;
}

/**
 * ¿Las hojas de consumo ya tienen su columna ID?
 *
 * La respuesta la deja /api/migracion/columna-id en la clave `registrosConId` de la
 * hoja "Config" cuando termina de correr, y es lo que enciende la escritura de ids.
 * Vive en la planilla y no en el entorno a propósito: la que tiene o no la columna es
 * la planilla, así que un deploy nuevo contra una instancia sin migrar hace lo
 * correcto sin que nadie configure nada.
 *
 * Se cachea con la etiqueta de config, igual que el mapa de carpetas de Drive.
 */
export async function registrosConId() {
  const data = await apiGet(
    { action: "getConfig", key: "registrosConId" },
    { tag: TAGS.config, revalidate: 300 },
  );
  return data && data.value === true;
}

/** Escribe registros nuevos. Devuelve cuántas filas se agregaron. */
export async function appendRecords(records) {
  const bySheet = rowsBySheet(records, await registrosConId());
  let written = 0;
  for (const [sheet, values] of Object.entries(bySheet)) {
    if (!values.length) continue;
    await apiPost({ action: "append", sheet, values });
    written += values.length;
  }
  return written;
}

// Un id posicional (`comb-12`, la fila 14) contra un id real (`comb_lz3k_7`). El
// guion medio contra el guion bajo es toda la diferencia, y es deliberada: los dos
// conviven mientras haya filas sin migrar.
const RE_ID_POSICIONAL = /^(comb|elec|agua)-(\d+)$/;
const RE_PREFIJO = /^(comb|elec|agua)[-_]/;

/** El layout de la hoja donde vive un registro, deducido del prefijo de su id. */
function layoutDeId(id) {
  const m = RE_PREFIJO.exec(id || "");
  return m ? BY_PREFIX[m[1]] : null;
}

/**
 * Renombra una sucursal en todos sus registros históricos.
 *
 * En el prototipo esta operación (CONFIG/RENAME_HISTORY) solo tocaba el arreglo
 * de registros en memoria: la planilla quedaba con el nombre viejo y al recargar
 * la página el cambio se perdía, aunque la app hubiera dicho "actualizado todo".
 * Acá se escriben las celdas de verdad.
 *
 * Devuelve cuántas filas se actualizaron.
 */
export async function renameSucursalInRecords(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return 0;
  const records = await readRecords();
  const bySheet = new Map();
  for (const r of records) {
    if (r.sucursal !== oldName) continue;
    const layout = LAYOUT[r.type];
    if (!layout) continue;
    if (!bySheet.has(layout.sheet)) bySheet.set(layout.sheet, []);
    bySheet.get(layout.sheet).push({ row: r._sheetRow, col: layout.cols.sucursal, value: newName });
  }
  let updated = 0;
  for (const [sheet, cells] of bySheet) {
    await apiPost({ action: "updateCells", sheet, cells });
    updated += cells.length;
  }
  return updated;
}

/**
 * Edición puntual de una celda (edición inline del dashboard, y la celda Link al
 * adjuntar un documento). La fecha viaja como ISO desde la UI y se escribe en
 * DD-MM-YY, el formato que parseDate lee.
 *
 * Dos caminos, según qué identidad tenga el registro:
 *
 *   id real (`comb_lz3k_7`)  → se busca la fila por su columna ID y se escribe ahí.
 *   id posicional (`comb-12`) → se calcula la fila desde el índice, como antes.
 *
 * El segundo es el que hay que sacar. Su problema no es que falle, es que acierta
 * casi siempre: la fila 14 sigue siendo la fila 14 hasta que alguien ordena la
 * planilla o borra una fila de arriba, y entonces la edición se escribe en el
 * registro de al lado sin ningún error. Sobrevive únicamente para las filas que
 * todavía no pasaron por /api/migracion/columna-id.
 */
export async function updateRecordField(id, field, value) {
  const layout = layoutDeId(id);
  const col = layout && layout.cols[field];
  if (!layout || !col) throw new Error(`Registro no editable en la planilla: ${id}.${field}`);
  const valor = field === "date" ? fmtDDMMYY(value) : value;

  const posicional = RE_ID_POSICIONAL.exec(id);
  if (posicional) {
    const row = parseInt(posicional[2], 10) + 2;
    await apiPost({ action: "update", sheet: layout.sheet, row, col, value: valor });
    return { sheet: layout.sheet, row, col, porId: false };
  }

  const res = await apiPostSoloSdk({
    action: "updateCeldasPorClave",
    sheet: layout.sheet,
    cols: [layout.cols.id],
    clave: [id],
    celdas: [{ col, value: valor }],
  });
  // Que no se encuentre la fila es un error de verdad, no un no-op silencioso: el
  // usuario editó algo y hay que decirle que no quedó guardado.
  if (!res || !res.filas) {
    throw new Error(`No se encontró el registro ${id} en la hoja ${layout.sheet}.`);
  }
  return { sheet: layout.sheet, col, porId: true, filas: res.filas };
}
