import "server-only";
import * as XLSX from "xlsx";

// Export a Excel del módulo Medidores: hoja "Detalle" (una fila por medidor y
// mes) y hoja "Totales por mes". Portado de medExportExcel en proto/medidores.jsx.
//
// En el prototipo el archivo se armaba en el navegador con la librería xlsx
// cargada por CDN; acá corre en el servidor, igual que los extractores de PDF, y
// vuelve como base64.

import { monthLabelShort } from "../domain/format";
import {
  consumoFor,
  costoFor,
  MED_TYPES,
  medFacturable,
  medUnit,
  meterReadingFor,
  monthTotals,
  PAY_LABEL,
  payStatus,
} from "../domain/medidores-calc";
import { metersFor } from "../domain/medidores";

const DETALLE_HEAD = [
  "Sucursal", "Tipo", "Medidor", "N°", "Mes", "Lectura", "Consumo", "Unidad",
  "Costo", "Estado pago", "Factura", "Pago", "Respaldo",
];

const DETALLE_COLS = [18, 12, 22, 10, 10, 12, 12, 8, 12, 13, 30, 30, 30].map((wch) => ({ wch }));

// Columnas de link en la hoja Detalle: letra y su índice en la fila.
const COLS_LINK = [["K", 10], ["L", 11], ["M", 12]];

const nombreArchivo = (s) => String(s || "").replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, "-");

/**
 * @param M       módulo completo del cliente { meters, readings, prices, docs }
 * @param records registros globales, para la fila "Total boleta"
 * @param meses   meses del período, en orden cronológico
 * @returns { base64, filename }
 */
export function medidoresWorkbook({ M, records, sucursal, tipo, meses }) {
  const meters = metersFor(M, sucursal, tipo);
  const unidad = medUnit(tipo);
  const tipoLbl = MED_TYPES[tipo] ? MED_TYPES[tipo].label : tipo;

  const detalle = [DETALLE_HEAD];
  for (const m of meters) {
    for (const mk of meses) {
      const lect = meterReadingFor(M.readings, m.id, mk);
      const cons = consumoFor(M.readings, m.id, mk);
      const costo = costoFor(M.readings, M.prices, m, mk);
      const docs = (M.docs || {})[m.id + "__" + mk] || {};
      detalle.push([
        sucursal,
        tipoLbl,
        m.nombre,
        m.numero || "",
        monthLabelShort(mk),
        lect == null ? "" : lect,
        cons == null ? "" : cons,
        unidad,
        costo == null ? "" : Math.round(costo),
        medFacturable(m)
          ? PAY_LABEL[payStatus(M.docs, m.id, mk)]
          : "Configurado para no ser facturado",
        docs.factura?.link || "",
        docs.pago?.link || "",
        docs.respaldo?.link || "",
      ]);
    }
  }

  const totales = [["Mes", "Total medidores", "Total boleta", "Diferencia"]];
  for (const mk of meses) {
    const t = monthTotals(meters, M.readings, M.prices, records, sucursal, tipo, mk);
    totales.push([
      monthLabelShort(mk),
      t.totalMedidores == null ? "" : Math.round(t.totalMedidores),
      t.totalBoleta == null ? "" : Math.round(t.totalBoleta),
      t.diferencia == null ? "" : Math.round(t.diferencia),
    ]);
  }

  const hojaDetalle = XLSX.utils.aoa_to_sheet(detalle);
  hojaDetalle["!cols"] = DETALLE_COLS;
  // Los links de Drive quedan como hipervínculos, no como texto.
  for (let r = 1; r < detalle.length; r++) {
    for (const [col, ci] of COLS_LINK) {
      const url = detalle[r][ci];
      const ref = col + (r + 1);
      if (url && hojaDetalle[ref]) hojaDetalle[ref].l = { Target: url, Tooltip: "Abrir documento" };
    }
  }

  const hojaTotales = XLSX.utils.aoa_to_sheet(totales);
  hojaTotales["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaDetalle, "Detalle");
  XLSX.utils.book_append_sheet(wb, hojaTotales, "Totales por mes");

  return {
    base64: XLSX.write(wb, { type: "base64", bookType: "xlsx" }),
    filename: `Medidores_${nombreArchivo(sucursal)}_${nombreArchivo(tipoLbl)}.xlsx`,
  };
}
