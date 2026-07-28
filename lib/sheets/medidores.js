import "server-only";
import { apiGet, apiPost, TAGS } from "../apps-script";
import { toNumber } from "../domain/parse";

// Módulo Medidores: hojas "Medidores", "Lecturas Medidor" y "Precios Medidor".
// Mismo patrón clear+rewrite que emisiones y config. Los documentos adjuntos
// (factura, pago, respaldo) viajan dentro de la fila de la lectura: una fila por
// (medidor, mes) con lectura y/o links de Drive.

// Medidores: [id, sucursal, tipo, nombre, numero, activo, facturable]
export function flattenMeters(meters) {
  return (meters || []).map((m) => [
    m.id,
    m.sucursal || "",
    m.type || "",
    m.nombre || "",
    m.numero || "",
    m.activo ? "Sí" : "No",
    m.facturable === false ? "No" : "Sí",
  ]);
}

export function unflattenMeters(rows) {
  return (rows || [])
    .filter((r) => r[0])
    .map((r) => ({
      id: r[0],
      sucursal: r[1] || "",
      type: r[2] || "",
      nombre: r[3] || "",
      numero: r[4] != null ? String(r[4]) : "",
      activo: String(r[5]).trim().toLowerCase() !== "no",
      // Columna agregada después: vacío se lee como facturable.
      facturable: String(r[6] == null ? "" : r[6]).trim().toLowerCase() !== "no",
    }));
}

// Lecturas + docs: [id, meterId, periodo, lectura,
//                   facturaLink, facturaNombre, facturaFileId,
//                   pagoLink, pagoNombre, pagoFileId,
//                   respaldoLink, respaldoNombre, respaldoFileId]
const docCells = (d) => [d ? d.link || "" : "", d ? d.name || "" : "", d ? d.fileId || "" : ""];

export function flattenReadings(readings, docs) {
  const map = new Map();
  for (const r of readings || []) {
    map.set(r.meterId + "__" + r.month, {
      id: r.id || "",
      meterId: r.meterId,
      month: r.month,
      lectura: r.lectura,
    });
  }
  // Un (medidor, mes) puede tener documentos sin lectura; se crea la fila igual.
  for (const [key, d] of Object.entries(docs || {})) {
    const i = key.indexOf("__");
    const meterId = key.slice(0, i);
    const month = key.slice(i + 2);
    const cur = map.get(key) || { id: "", meterId, month, lectura: "" };
    cur.factura = (d && d.factura) || null;
    cur.pago = (d && d.pago) || null;
    cur.respaldo = (d && d.respaldo) || null;
    map.set(key, cur);
  }
  return [...map.values()].map((r) => [
    r.id || "",
    r.meterId,
    r.month,
    r.lectura == null ? "" : r.lectura,
    ...docCells(r.factura),
    ...docCells(r.pago),
    ...docCells(r.respaldo),
  ]);
}

export function unflattenReadings(rows) {
  const readings = [];
  const docs = {};
  for (const r of rows || []) {
    const id = r[0] || "";
    const meterId = r[1] || "";
    const month = r[2] || "";
    if (!meterId || !month) continue;

    // El Sheet devuelve display values ("15771,848"): toNumber normaliza.
    const lectura = r[3];
    if (lectura !== "" && lectura != null) {
      readings.push({
        id: id || `lec_${meterId}_${month}`,
        meterId,
        month,
        lectura: toNumber(lectura),
      });
    }

    const [fLink, fName, fId] = [r[4] || "", r[5] || "", r[6] || ""];
    const [pLink, pName, pId] = [r[7] || "", r[8] || "", r[9] || ""];
    const [rLink, rName, rId] = [r[10] || "", r[11] || "", r[12] || ""];
    if (fLink || pLink || rLink) {
      const key = `${meterId}__${month}`;
      docs[key] = {};
      if (fLink) docs[key].factura = { link: fLink, name: fName, fileId: fId };
      if (pLink) docs[key].pago = { link: pLink, name: pName, fileId: pId };
      if (rLink) docs[key].respaldo = { link: rLink, name: rName, fileId: rId };
    }
  }
  return { readings, docs };
}

// Precios: [sucursal, tipo, periodo, precio]
export function flattenPrices(prices) {
  return (prices || []).map((p) => [p.sucursal || "", p.type || "", p.month || "", p.precio]);
}

export function unflattenPrices(rows) {
  return (rows || [])
    .filter((r) => r[0] && r[2])
    .map((r) => ({ sucursal: r[0], type: r[1] || "", month: r[2], precio: toNumber(r[3]) }));
}

/** Estado completo del módulo: { meters, readings, prices, docs }. */
export async function readMedidores() {
  const opts = { tag: TAGS.medidores, revalidate: 30 };
  const [med, lec, pre] = await Promise.all([
    apiGet({ action: "getMedidores" }, opts),
    apiGet({ action: "getLecturasMedidor" }, opts),
    apiGet({ action: "getPreciosMedidor" }, opts),
  ]);
  const { readings, docs } = unflattenReadings((lec && lec.rows) || []);
  return {
    meters: unflattenMeters((med && med.rows) || []),
    readings,
    prices: unflattenPrices((pre && pre.rows) || []),
    docs,
  };
}

/**
 * Reescribe las tres hojas. Secuencial a propósito: el Apps Script serializa
 * las mutaciones con un lock de 30s, en paralelo se pisarían esperando.
 */
export async function writeMedidores(M) {
  await apiPost({ action: "setMedidores", rows: flattenMeters(M.meters) });
  await apiPost({ action: "setLecturasMedidor", rows: flattenReadings(M.readings, M.docs) });
  await apiPost({ action: "setPreciosMedidor", rows: flattenPrices(M.prices) });
}
