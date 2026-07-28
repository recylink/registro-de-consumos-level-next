// Iconstruye: consolidado de compras de combustible en Excel.
// Portado verbatim de proto/extractors.jsx (réplica de appscript.txt).
//
// Filas de datos desde la 14; se agrupan por mes y proveedor. El gas viene en
// cilindros y se convierte a kilos.

import * as XLSX from "xlsx";

// ----- Iconstruye Excel parser (replica de appscript.txt) ----------------
const RC_EXCEL = {
  FILA_DATOS: 14,
  COL_FECHA: 3, COL_PROVEEDOR: 9, COL_CANTIDAD: 16, COL_SUBTOTAL: 21,
  KG_POR_CILINDRO: 45,
};
function rcExcelDate(val) {
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d)) return d;
  }
  return null;
}
function rcFinDeMes(y, m) {
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
export async function rcParseIconstruye(file, tipoCombust /* "Petróleo Diesel" | "Gas" */) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const datos = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const desde = RC_EXCEL.FILA_DATOS - 1;
  const filas = datos.slice(desde);
  const filtradas = filas.filter((fila) => {
    const ocNo = fila[0];
    const fecha = rcExcelDate(fila[RC_EXCEL.COL_FECHA - 1]);
    const cantidad = fila[RC_EXCEL.COL_CANTIDAD - 1];
    return ocNo !== "" && ocNo != null &&
      fecha instanceof Date && fecha.getFullYear() > 1990 &&
      typeof cantidad === "number" && cantidad > 0;
  });
  if (!filtradas.length) return [];

  // Group by año-mes + proveedor
  const grupos = {};
  filtradas.forEach((fila) => {
    const fecha = rcExcelDate(fila[RC_EXCEL.COL_FECHA - 1]);
    const proveedor = fila[RC_EXCEL.COL_PROVEEDOR - 1] || "";
    const cantidad = fila[RC_EXCEL.COL_CANTIDAD - 1];
    const subtotal = fila[RC_EXCEL.COL_SUBTOTAL - 1];
    const y = fecha.getFullYear(), m = fecha.getMonth() + 1;
    const clave = `${y}-${String(m).padStart(2, "0")}|${proveedor}`;
    if (!grupos[clave]) grupos[clave] = { y, m, proveedor, cantidad: 0, costo: 0 };
    grupos[clave].cantidad += cantidad;
    grupos[clave].costo += (typeof subtotal === "number" ? subtotal : 0);
  });
  return Object.values(grupos).map((g) => {
    const consumo = tipoCombust === "Gas"
      ? g.cantidad * RC_EXCEL.KG_POR_CILINDRO
      : g.cantidad;
    return {
      fecha: rcFinDeMes(g.y, g.m),
      proveedor: g.proveedor,
      cantidad: consumo,
      costo: Math.round(g.costo),
      tipoCombustible: tipoCombust,
    };
  });
}
