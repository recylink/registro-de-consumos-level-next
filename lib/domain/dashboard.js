// Agregadores del dashboard: filtrado, KPIs, series del gráfico y heatmap.
// Portado de proto/dashboard.jsx, donde estas funciones recibían el `state`
// global; acá reciben datos y filtros explícitos.
//
// Regla que atraviesa todo el módulo: **los registros eliminados nunca suman**.
// Aparecen en la tabla de detalle si el usuario los pide, pero no entran en
// totales, KPIs, gráficos ni heatmap.

import { FUEL_SUBCATS_CATALOG, TYPES } from "./catalog";
import { periodToMonthKeys, prevMonthKey } from "./periods";
import { activeSucNames, getSubcatsFor } from "./sucursales";

export const FILTROS_INICIALES = {
  sucursal: "all",
  period: "12m",
  typeTab: "combustible",
  subcat: "all",
  estado: "activa",
};

/** Registros que pasan los filtros, incluidos los eliminados si se piden. */
export function filtrarRegistros(records, filtros, anchor) {
  const { sucursal, period, typeTab, subcat, estado } = filtros;
  const meses = new Set(periodToMonthKeys(period, anchor));
  return records.filter((r) => {
    if (estado === "activa" && r.estado === "eliminada") return false;
    if (estado === "eliminada" && r.estado !== "eliminada") return false;
    if (sucursal !== "all" && r.sucursal !== sucursal) return false;
    if (!meses.has(String(r.date).slice(0, 7))) return false;
    if (typeTab !== "all" && r.type !== typeTab) return false;
    if (typeTab === r.type && subcat !== "all" && r.subcat !== subcat) return false;
    return true;
  });
}

// Mismo alcance de sucursal/tipo/subcategoría, sin acotar por período: se usa
// para comparar contra el mes anterior, que puede caer fuera del período.
function enAlcance(r, { sucursal, typeTab, subcat }) {
  if (r.estado === "eliminada") return false;
  if (sucursal !== "all" && r.sucursal !== sucursal) return false;
  if (typeTab !== "all" && r.type !== typeTab) return false;
  if (typeTab === r.type && subcat !== "all" && r.subcat !== subcat) return false;
  return true;
}

const sumar = (arr, campo) => arr.reduce((a, r) => a + (r[campo] || 0), 0);
const delta = (actual, previo) => (previo > 0 ? ((actual - previo) / previo) * 100 : 0);

export function calcularKpis({ records, sucursales, filtros, anchor }) {
  const mesActual = anchor;
  const mesPrevio = prevMonthKey(anchor);

  const enPeriodo = filtrarRegistros(records, filtros, anchor).filter((r) => r.estado !== "eliminada");
  const delMes = enPeriodo.filter((r) => String(r.date).startsWith(mesActual));
  const alcance = records.filter((r) => enAlcance(r, filtros));
  const delMesPrevio = alcance.filter((r) => String(r.date).startsWith(mesPrevio));

  const tipoPeriodo = sumar(enPeriodo.filter((r) => r.type === filtros.typeTab), "cantidad");
  const tipoActual = sumar(delMes.filter((r) => r.type === filtros.typeTab), "cantidad");
  const tipoPrevio = sumar(delMesPrevio.filter((r) => r.type === filtros.typeTab), "cantidad");

  return {
    tipoPeriodo,
    tipoActual,
    tipoDelta: delta(tipoActual, tipoPrevio),
    costoPeriodo: sumar(enPeriodo, "costo"),
    costoActual: sumar(delMes, "costo"),
    costoDelta: delta(sumar(delMes, "costo"), sumar(delMesPrevio, "costo")),
    sucursalesQueReportan: new Set(enPeriodo.map((r) => r.sucursal)).size,
    totalSucursales: activeSucNames(sucursales).length,
    registrosEnPeriodo: enPeriodo.length,
    mesPrevio,
  };
}

// ---- Unidades mezcladas ---------------------------------------------------
// Combustible es el único tipo cuyas subcategorías pueden medirse en unidades
// distintas (litros, kilos, m³). Sumar litros de diésel con kilos de GLP no
// significa nada, así que cuando conviven se dibuja un bloque por unidad.

const CATEGORIA_UNIDAD = {
  L: "Volumen", gal: "Volumen", "m³": "Volumen",
  kg: "Masa", t: "Masa",
  kWh: "Energía",
};

export function unidadDeSubcat(type, subId) {
  if (type !== "combustible") return TYPES[type]?.unit || "";
  return FUEL_SUBCATS_CATALOG[subId]?.defaultUnit || "";
}

export function etiquetaBloque(unidad) {
  const cat = CATEGORIA_UNIDAD[unidad];
  return cat ? `${cat} · ${unidad}` : unidad;
}

// Agrupa las subcategorías por unidad. Devuelve null si todas comparten unidad
// (el caso normal, un solo bloque).
function bloquesPorUnidad(sucursales, typeTab, subcat) {
  if (typeTab !== "combustible" || subcat !== "all") return null;
  const conUnidad = getSubcatsFor(sucursales, typeTab)
    .map((s) => ({ sub: s, unidad: unidadDeSubcat("combustible", s.id) }))
    .filter((x) => x.unidad);
  const unidades = [...new Set(conUnidad.map((x) => x.unidad))];
  if (unidades.length <= 1) return null;
  return unidades.map((u) => ({
    unidad: u,
    label: etiquetaBloque(u),
    subs: conUnidad.filter((x) => x.unidad === u).map((x) => x.sub),
  }));
}

const PALETA = [
  "var(--rl-primary-900)",
  "var(--rl-success-600)",
  "var(--rl-error-500)",
  "var(--rl-warning-700)",
  "var(--rl-gray-700)",
];

/** Series mensuales por subcategoría para el gráfico de líneas. */
export function datosGrafico({ records, sucursales, filtros, anchor }) {
  const { typeTab, period, subcat, sucursal } = filtros;
  const meses = periodToMonthKeys(period, anchor);
  const tipo = TYPES[typeTab];
  const subs = getSubcatsFor(sucursales, typeTab);

  const recs = records.filter(
    (r) =>
      r.estado !== "eliminada" &&
      r.type === typeTab &&
      (sucursal === "all" || r.sucursal === sucursal) &&
      meses.includes(String(r.date).slice(0, 7)),
  );

  const colores = [tipo.color, ...PALETA];
  const armarSeries = (lista) => {
    if (lista.length === 0) {
      return [
        {
          key: typeTab,
          label: tipo.label,
          color: tipo.color,
          data: meses.map((mk) => sumar(recs.filter((r) => String(r.date).startsWith(mk)), "cantidad")),
        },
      ];
    }
    return lista.map((sub, i) => ({
      key: sub.id,
      label: sub.label,
      unit: unidadDeSubcat(typeTab, sub.id),
      color: colores[i % colores.length],
      // Sin más colores en la paleta, la línea se distingue por el trazo.
      dashed: i >= colores.length,
      data: meses.map((mk) =>
        sumar(recs.filter((r) => String(r.date).startsWith(mk) && r.subcat === sub.id), "cantidad"),
      ),
    }));
  };

  const bloques = bloquesPorUnidad(sucursales, typeTab, subcat);
  if (bloques) {
    return {
      mixed: true,
      months: meses,
      blocks: bloques.map((b) => ({ unit: b.unidad, label: b.label, series: armarSeries(b.subs) })),
    };
  }

  const seleccionadas = subcat === "all" ? subs : subs.filter((s) => s.id === subcat);
  const unidad =
    typeTab === "combustible" && subcat !== "all" ? unidadDeSubcat("combustible", subcat) : tipo.unit;
  return { mixed: false, months: meses, series: armarSeries(seleccionadas), unit: unidad };
}

/** Matriz sucursal × mes para el heatmap. */
export function datosHeatmap({ records, sucursales, filtros, anchor }) {
  const { typeTab, period, subcat } = filtros;
  const meses = periodToMonthKeys(period, anchor);
  const base = records.filter(
    (r) =>
      r.estado !== "eliminada" &&
      r.type === typeTab &&
      meses.includes(String(r.date).slice(0, 7)) &&
      (subcat === "all" || r.subcat === subcat),
  );

  const armarFilas = (recs) =>
    activeSucNames(sucursales).map((suc) => ({
      suc,
      cells: meses.map((mk) =>
        sumar(recs.filter((r) => r.sucursal === suc && String(r.date).startsWith(mk)), "cantidad"),
      ),
    }));

  const bloques = bloquesPorUnidad(sucursales, typeTab, subcat);
  if (bloques) {
    return {
      mixed: true,
      blocks: bloques.map((b) => {
        const ids = b.subs.map((s) => s.id);
        return {
          unit: b.unidad,
          label: b.label,
          months: meses,
          rows: armarFilas(base.filter((r) => ids.includes(r.subcat))),
        };
      }),
    };
  }

  const unidad =
    typeTab === "combustible" && subcat !== "all"
      ? unidadDeSubcat("combustible", subcat)
      : TYPES[typeTab].unit;
  return { mixed: false, months: meses, rows: armarFilas(base), unit: unidad };
}

/** Totales por tipo de consumo, para el sublabel de las pestañas. */
export function totalesPorTipo({ records, filtros, anchor }) {
  const meses = new Set(periodToMonthKeys(filtros.period, anchor));
  const out = {};
  for (const k of Object.keys(TYPES)) {
    out[k] = sumar(
      records.filter(
        (r) =>
          r.estado !== "eliminada" &&
          r.type === k &&
          meses.has(String(r.date).slice(0, 7)) &&
          (filtros.sucursal === "all" || r.sucursal === filtros.sucursal),
      ),
      "cantidad",
    );
  }
  return out;
}
