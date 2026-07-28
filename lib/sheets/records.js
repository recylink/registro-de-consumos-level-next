import "server-only";
import { apiGet, apiPost, TAGS } from "../apps-script";
import { EMPRESA, SHEETS } from "../instance";
import { subcatLabel } from "../domain/catalog";
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

const LAYOUT = {
  combustible: {
    sheet: SHEETS.COMBUSTIBLE,
    idPrefix: "comb",
    width: 10,
    cols: {
      link: 1, date: 2, cantidad: 3, costo: 4, empresa: 5,
      sucursal: 6, subcat: 7, provider: 8, estado: 9, origen: 10,
    },
  },
  electricidad: {
    sheet: SHEETS.ELECTRICIDAD,
    idPrefix: "elec",
    width: 11,
    cols: {
      link: 1, numeroCliente: 2, date: 3, cantidad: 4, costo: 5, empresa: 6,
      sucursal: 7, tipoLabel: 8, provider: 9, estado: 10, origen: 11,
    },
  },
  agua: {
    sheet: SHEETS.AGUA,
    idPrefix: "agua",
    width: 12,
    cols: {
      link: 1, numeroCliente: 2, date: 3, cantidad: 4, costo: 5, empresa: 6,
      sucursal: 7, tipoLabel: 8, provider: 9, subcat: 10, estado: 11, origen: 12,
    },
  },
};

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

  const rec = {
    id: `${idPrefix}-${i}`,
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
    const rows = (data[layout.sheet] || []).slice(1); // saltar encabezado
    rows.forEach((row, i) => {
      const rec = toRecord(type, row, i);
      if (rec) records.push(rec);
    });
  }
  return records;
}

/** Registro del dominio → fila del Sheet, en el orden de su hoja. */
function toRow(rec) {
  const layout = LAYOUT[rec.type];
  if (!layout) return null;
  const { cols, width } = layout;
  const isManual = rec.origen === "manual";
  const row = new Array(width).fill("");
  const put = (col, value) => {
    if (col) row[col - 1] = value;
  };

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
export function rowsBySheet(records) {
  const out = {};
  for (const rec of records || []) {
    const layout = LAYOUT[rec.type];
    const row = toRow(rec);
    if (!layout || !row) continue;
    (out[layout.sheet] ||= []).push(row);
  }
  return out;
}

/** Escribe registros nuevos. Devuelve cuántas filas se agregaron. */
export async function appendRecords(records) {
  const bySheet = rowsBySheet(records);
  let written = 0;
  for (const [sheet, values] of Object.entries(bySheet)) {
    if (!values.length) continue;
    await apiPost({ action: "append", sheet, values });
    written += values.length;
  }
  return written;
}

/**
 * id de registro + campo → celda concreta del Sheet. Solo resuelve registros
 * que vienen de la planilla (ids "comb-N" / "elec-N" / "agua-N").
 */
export function resolveSheetCell(id, field) {
  const m = /^(comb|elec|agua)-(\d+)$/.exec(id || "");
  if (!m) return null;
  const layout = BY_PREFIX[m[1]];
  const col = layout && layout.cols[field];
  if (!col) return null;
  return { sheet: layout.sheet, row: parseInt(m[2], 10) + 2, col };
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
 * Edición puntual de una celda (edición inline del dashboard). La fecha viaja
 * como ISO desde la UI y se escribe en DD-MM-YY, el formato que parseDate lee.
 */
export async function updateRecordField(id, field, value) {
  const target = resolveSheetCell(id, field);
  if (!target) throw new Error(`Registro no editable en la planilla: ${id}.${field}`);
  await apiPost({
    action: "update",
    sheet: target.sheet,
    row: target.row,
    col: target.col,
    value: field === "date" ? fmtDDMMYY(value) : value,
  });
  return target;
}
