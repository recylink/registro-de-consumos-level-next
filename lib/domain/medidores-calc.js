// Cálculos del módulo Medidores. Portado de proto/medidores-calc.jsx.
//
// Cadena completa: lectura → consumo (diferencia con la lectura anterior) →
// costo (consumo × precio vigente) → comparación contra el total de la boleta.
// Todo puro, sin React.
//
// Regla de fondo del módulo: estas lecturas son control operativo. No alimentan
// el consumo oficial ni la huella de emisiones — para eso están los Registros con
// su boleta.

import { fmtNum } from "./format";

// Tipos de medidor soportados. Reusa tokens de color de TYPES global.
export const MED_TYPES = {
  electricidad: { id: "electricidad", label: "Electricidad", unit: "kWh", icon: "bolt",              color: "var(--rl-primary-900)", bg: "var(--rl-primary-50)" },
  combustible:  { id: "combustible",  label: "Combustible",  unit: "L",   icon: "local_gas_station", color: "var(--rl-fuel)",        bg: "var(--rl-fuel-bg)" },
  agua:         { id: "agua",         label: "Agua",         unit: "m³",  icon: "water_drop",         color: "var(--rl-success-700)", bg: "var(--rl-success-50)" },
};

export function medUnit(type) { return MED_TYPES[type] ? MED_TYPES[type].unit : ""; }

function _hasVal(r) {
  return r && r.lectura != null && r.lectura !== "" && !isNaN(r.lectura);
}

// Lecturas de un medidor, cronológicas, solo las que tienen valor numérico.
export function meterReadings(readings, meterId) {
  return (readings || [])
    .filter(r => r.meterId === meterId && _hasVal(r))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

// Lectura puntual de un medidor en un mes (o null).
export function meterReadingFor(readings, meterId, month) {
  const r = (readings || []).find(x => x.meterId === meterId && x.month === month);
  return _hasVal(r) ? Number(r.lectura) : null;
}

// Lectura previa CON valor, estrictamente anterior a `month` (o null).
export function prevReading(readings, meterId, month) {
  const list = meterReadings(readings, meterId).filter(r => r.month < month);
  return list.length ? list[list.length - 1] : null;
}

// Lectura siguiente CON valor, estrictamente posterior a `month` (o null).
export function nextReading(readings, meterId, month) {
  const list = meterReadings(readings, meterId).filter(r => r.month > month);
  return list.length ? list[0] : null;
}

// ¿Es la primera lectura del medidor? (no hay lectura previa con valor)
export function isFirstReading(readings, meterId, month) {
  return prevReading(readings, meterId, month) == null;
}

// Pasos de mes de `a` a `b` (b-a). 1 = meses consecutivos.
export function monthsGap(a, b) {
  if (!a || !b) return 0;
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

// Consumo = lectura(month) − lectura(previa con valor). null si no hay lectura
// actual o es el primer mes del medidor (sin previa → sin cálculo).
export function consumoFor(readings, meterId, month) {
  const cur = meterReadingFor(readings, meterId, month);
  if (cur == null) return null;
  const prev = prevReading(readings, meterId, month);
  if (!prev) return null;
  return cur - Number(prev.lectura);
}

/** Precios válidos de (sucursal, tipo), del mes más antiguo al más nuevo. */
export function pricesFor(prices, suc, type) {
  return (prices || [])
    .filter(p => p.sucursal === suc && p.type === type
      && p.precio != null && p.precio !== "" && !isNaN(p.precio))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * Precio vigente de un mes, con su procedencia. El precio es una función
 * escalonada: el valor ingresado en un mes rige desde ese mes hacia adelante,
 * hasta que aparezca otro.
 *
 *   { precio, desde, propio }
 *   precio null → ese mes no tiene tarifa y su costo no se puede calcular.
 *   desde        → mes en que se ingresó el precio que rige (para explicarlo).
 *   propio       → el precio se ingresó en ESTE mes, no se hereda.
 *
 * No hay herencia hacia atrás: antes existía un fallback al precio más temprano,
 * así que ingresar la tarifa de julio calculaba los costos de enero a junio con
 * ella y nada lo indicaba. Un mes anterior al primer precio queda sin costo, y la
 * UI ofrece aplicar la tarifa hacia atrás si es lo que se quiere.
 */
export function priceInfo(prices, suc, type, month) {
  const vigentes = pricesFor(prices, suc, type).filter(p => p.month <= month);
  if (!vigentes.length) return { precio: null, desde: null, propio: false };
  const p = vigentes[vigentes.length - 1];
  return { precio: Number(p.precio), desde: p.month, propio: p.month === month };
}

/** Precio vigente de un mes, o null si no hay ninguno desde ese mes o antes. */
export function priceFor(prices, suc, type, month) {
  return priceInfo(prices, suc, type, month).precio;
}

/**
 * Meses posteriores que heredan el precio de `month`: los que quedan entre este
 * precio y el siguiente ingresado. Sirve para advertir el alcance real de editar
 * una tarifa vieja, que arrastra los costos de todos ellos.
 */
export function monthsInheriting(prices, suc, type, month, monthsView) {
  const siguiente = pricesFor(prices, suc, type).find(p => p.month > month);
  return (monthsView || []).filter(
    (m) => m > month && (!siguiente || m < siguiente.month),
  );
}

// Costo a pagar = consumo × precio. null si falta consumo o precio.
export function costoFor(readings, prices, meter, month) {
  const cons = consumoFor(readings, meter.id, month);
  if (cons == null) return null;
  const price = priceFor(prices, meter.sucursal, meter.type, month);
  if (price == null) return null;
  return cons * price;
}

/**
 * Consumo total de la boleta para (sucursal, tipo, mes), en la unidad `unidad`.
 *
 *   { total, fuera }
 *   total  suma de las cantidades que están EN esa unidad, o null si no hay ninguna.
 *   fuera  las otras unidades que aparecieron y quedaron fuera de la suma.
 *
 * Se filtra por unidad y no se suma todo junto porque en combustible no todo se
 * mide igual: el diésel y la bencina vienen en litros y el GLP y el gas natural
 * en kilos. Sumar 1.200 L con 40 kg da 1.240 de nada. Los medidores de un tipo
 * comparten una sola unidad (medUnit), así que esa es la que manda, y lo que
 * queda fuera se informa en vez de desaparecer.
 */
export function boletaConsumoFor(records, suc, type, month, unidad) {
  let sum = 0, any = false;
  const fuera = new Set();
  (records || []).forEach(r => {
    if (r.estado === "eliminada") return;
    if (r.sucursal !== suc || r.type !== type) return;
    if (!r.date || !String(r.date).startsWith(month)) return;
    if (unidad && r.unit && r.unit !== unidad) { fuera.add(r.unit); return; }
    any = true;
    sum += Number(r.cantidad) || 0;
  });
  return { total: any ? sum : null, fuera: [...fuera] };
}

// Total Boleta = Σ costo de registros globales (state.records) de la sucursal+tipo+mes.
// null si no hay ningún registro global para ese mes (→ no mostrar diferencia, advertir).
export function boletaFor(records, suc, type, month) {
  let sum = 0, any = false;
  (records || []).forEach(r => {
    if (r.estado === "eliminada") return;
    if (r.sucursal !== suc || r.type !== type) return;
    if (!r.date || !String(r.date).startsWith(month)) return;
    any = true;
    sum += Number(r.costo) || 0;
  });
  return any ? sum : null;
}

// ¿El medidor entra en el proceso de facturación? Default sí: solo queda
// fuera si fue configurado explícitamente con facturable = false.
export function medFacturable(m) { return !m || m.facturable !== false; }

// Totales por mes para el footer de la matriz. Los medidores configurados
// como "no facturables" no suman al total calculado.
export function monthTotals(meters, readings, prices, records, suc, type, month) {
  let totalMedidores = 0;
  let anyMed = false;
  // Mismo recorrido para el consumo: se cuentan los mismos medidores que el
  // costo, así las dos comparaciones hablan del mismo conjunto.
  let consumoMedidores = 0;
  let anyCons = false;
  (meters || []).forEach(m => {
    if (!medFacturable(m)) return;
    const c = costoFor(readings, prices, m, month);
    if (c != null) { totalMedidores += c; anyMed = true; }
    const k = consumoFor(readings, m.id, month);
    if (k != null) { consumoMedidores += k; anyCons = true; }
  });
  const totalBoleta = boletaFor(records, suc, type, month);
  const diferencia = totalBoleta == null ? null : totalMedidores - totalBoleta;

  const unidad = medUnit(type);
  const bc = boletaConsumoFor(records, suc, type, month, unidad);
  const consumoBoleta = bc.total;

  return {
    totalMedidores: anyMed ? totalMedidores : null,
    totalBoleta,
    diferencia,
    unidad,
    consumoMedidores: anyCons ? consumoMedidores : null,
    consumoBoleta,
    // Sin uno de los dos lados no hay diferencia que mostrar, igual que en dinero.
    difConsumo: consumoBoleta == null || !anyCons ? null : consumoMedidores - consumoBoleta,
    // Unidades de este mes que la suma dejó fuera (combustible mezclado).
    unidadesFuera: bc.fuera,
  };
}

// Valida un valor de lectura para (medidor, mes). Devuelve { ok, error?, warn? }.
//   - menor que anterior → error (bloquea)
//   - igual a anterior   → ok + warn (consumo 0)
//   - hueco de meses      → ok + warn (completar mes faltante)
//   - mayor que siguiente → ok + warn (supera lectura siguiente)
export function validateReading({ readings, meterId, month, value }) {
  if (value === "" || value == null || isNaN(value)) return { ok: true };
  const v = Number(value);
  const prev = prevReading(readings, meterId, month);
  const next = nextReading(readings, meterId, month);
  if (prev) {
    const pv = Number(prev.lectura);
    if (v < pv)  return { ok: false, error: "Lectura menor que la anterior (" + fmtNum(pv) + "). No se permite." };
    if (v === pv) return { ok: true, warn: "Consumo 0 — igual a la lectura anterior." };
    if (monthsGap(prev.month, month) > 1) {
      return { ok: true, warn: "Hay meses sin lectura entre medio. Completa el mes faltante." };
    }
  }
  if (next) {
    const nv = Number(next.lectura);
    if (v > nv) return { ok: true, warn: "Supera la lectura del mes siguiente (" + fmtNum(nv) + "). Revisa el dato." };
  }
  return { ok: true };
}

// Estado de pago según documentos adjuntos.
export function payStatus(docs, meterId, month) {
  const d = (docs || {})[meterId + "__" + month];
  if (d && d.pago && d.pago.link)    return "pagado";
  if (d && d.factura && d.factura.link) return "facturado";
  return "por-facturar";
}
export const PAY_LABEL = { "por-facturar": "Por facturar", "facturado": "Facturado", "pagado": "Pagado" };
export const PAY_CHIP  = { "por-facturar": "neutral",       "facturado": "info",      "pagado": "success" };
