// Estado del módulo Medidores como datos: opciones de UI y transformaciones
// puras sobre { meters, readings, prices, docs }.
//
// En el prototipo esto eran ocho casos del reducer global (MED/SET_READING,
// MED/ADD_METER…). Acá son funciones que reciben el módulo y devuelven uno
// nuevo, así el componente de cliente las usa con un setState y el mismo código
// se puede probar sin React.
//
// Los cálculos (consumo, costo, totales, validación) viven en medidores-calc.js.

import { MED_TYPES } from "./medidores-calc";
import { nextMeterId, nextReadingId } from "./ids";

export const MED_TYPE_OPTS = Object.values(MED_TYPES).map((t) => ({
  value: t.id,
  label: t.label,
  icon: t.icon,
  iconBg: t.bg,
  iconColor: t.color,
}));

// Paleta de líneas por medidor (misma del diseño de referencia).
export const MED_LINE_COLORS = [
  "#0069A6", "#12B76A", "#F79009", "#7A5AF8",
  "#EF4444", "#0E9384", "#D444F1", "#EAAA08",
];

export const medColorAt = (i) =>
  MED_LINE_COLORS[((i % MED_LINE_COLORS.length) + MED_LINE_COLORS.length) % MED_LINE_COLORS.length];

/** Medidores de una (sucursal, tipo). Sin `incluirInactivos`, solo los activos. */
export function metersFor(M, suc, type, incluirInactivos) {
  return (M.meters || []).filter(
    (m) => m.sucursal === suc && m.type === type && (incluirInactivos || m.activo),
  );
}

/** Módulo vacío — mismo objeto que usa lib/data.js como fallback. */
export function emptyMedidores() {
  return { meters: [], readings: [], prices: [], docs: {} };
}

const vacio = (v) => v === "" || v == null || isNaN(v);

/** Escribe (o borra, con valor vacío) la lectura de un medidor en un mes. */
export function setReading(M, { meterId, month, lectura }) {
  const readings = (M.readings || []).filter((r) => !(r.meterId === meterId && r.month === month));
  if (!vacio(lectura)) {
    readings.push({ id: nextReadingId(), meterId, month, lectura: Number(lectura) });
  }
  return { ...M, readings };
}

/** Precio unitario de (sucursal, tipo, mes). Vacío lo borra. */
export function setPrice(M, { sucursal, type, month, precio }) {
  const prices = (M.prices || []).filter(
    (p) => !(p.sucursal === sucursal && p.type === type && p.month === month),
  );
  if (!vacio(precio)) prices.push({ sucursal, type, month, precio: Number(precio) });
  return { ...M, prices };
}

/** Adjunta o limpia (doc = null) un documento de (medidor, mes). */
export function setDoc(M, { meterId, month, kind, doc }) {
  const key = meterId + "__" + month;
  const actual = { ...((M.docs || {})[key] || {}) };
  actual[kind] = doc;
  return { ...M, docs: { ...(M.docs || {}), [key]: actual } };
}

export function addMeter(M, { sucursal, type, nombre, numero }) {
  const meter = {
    id: nextMeterId(),
    sucursal,
    type,
    nombre: (nombre || "").trim(),
    numero: (numero || "").trim(),
    activo: true,
    facturable: true,
  };
  return { ...M, meters: [...(M.meters || []), meter] };
}

export function editMeter(M, id, patch) {
  return { ...M, meters: (M.meters || []).map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

export function toggleMeter(M, id) {
  return { ...M, meters: (M.meters || []).map((m) => (m.id === id ? { ...m, activo: !m.activo } : m)) };
}

/**
 * ¿Ya existe otro medidor con ese número en la misma (sucursal, tipo)? El número
 * es opcional, así que vacío nunca choca.
 */
export function numeroDuplicado(lista, numero, ignorarId) {
  const n = (numero || "").trim();
  if (!n) return false;
  return lista.some((m) => m.id !== ignorarId && (m.numero || "").trim() === n);
}

/** Etiqueta "Nombre · N° 123" para reportes y tooltips. */
export function meterLabel(m) {
  return m.nombre + (m.numero ? " · N° " + m.numero : "");
}
