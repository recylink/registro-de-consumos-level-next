// Motor de cálculo de emisiones GEI. Portado de proto/emissions-calc.jsx.
//
// Todas las funciones reciben un mismo objeto de contexto en vez del estado
// global del prototipo:
//   { records, sucursales, emissions, anchor }
// y opcionalmente `filters` = { sucursal, period } con la misma semántica que el
// dashboard.
//
// Las emisiones NO se guardan: se calculan al leer, aplicando el factor vigente.
// Por eso cambiar un factor cambia también las vistas históricas, y por eso no
// existe un "recalcular histórico".

import { REFRIGERANTES_CATALOG } from "./emisiones";
import { periodToMonthKeys, monthsWindow } from "./periods";

/**
 * Sucursales que reportan electricidad en un sistema distinto del SEN. No hay
 * factor cargado para esos sistemas, así que su consumo eléctrico no se convierte
 * a emisiones y la pantalla lo advierte, en vez de mostrar un cero silencioso.
 */
export function sucursalesSinFactor(sucursales) {
  return (sucursales || [])
    .filter((s) => {
      const elec = s.items?.electricidad;
      if (!elec?.activo) return false;
      return (elec.subcats || []).some((sc) => sc.sistemaElectrico && sc.sistemaElectrico !== "SEN");
    })
    .map((s) => s.id);
}

/** Factor vigente: override de la sucursal si existe, si no el de empresa. */
export function factorFor(emissions, sucId, key) {
  const ov = emissions.factoresSucursal?.[sucId];
  if (ov?.[key]) return ov[key].value;
  return emissions.factoresEmpresa?.[key]?.value ?? null;
}

export function esFactorPropio(emissions, sucId, key) {
  return !!emissions.factoresSucursal?.[sucId]?.[key];
}

const mesesDelFiltro = (filters, anchor) =>
  filters?.period ? new Set(periodToMonthKeys(filters.period, anchor)) : null;

const coincideSucursal = (filtro, nombre) => !filtro || filtro === "all" || filtro === nombre;

/** Cada registro activo con su emisión en tCO₂e. */
export function emisionesPorRegistro({ records, sucursales, emissions, anchor }, filters) {
  const porNombre = {};
  for (const s of sucursales || []) porNombre[s.nombre] = s;
  const sinFactor = sucursalesSinFactor(sucursales);
  const meses = mesesDelFiltro(filters, anchor);

  return (records || [])
    .filter((r) => r.estado !== "eliminada")
    .filter((r) => coincideSucursal(filters?.sucursal, r.sucursal))
    .filter((r) => !meses || meses.has(String(r.date).slice(0, 7)))
    .map((r) => {
      const suc = porNombre[r.sucursal];
      const sucId = suc ? suc.id : null;
      // El combustible tiene un factor por subcategoría; electricidad y agua uno
      // por tipo.
      const key = r.type === "combustible" ? r.subcat : r.type;
      const f = factorFor(emissions, sucId, key);
      const def = emissions.factoresEmpresa?.[key];
      const scope = def ? def.scope : r.type === "electricidad" ? 2 : r.type === "agua" ? 3 : 1;
      const sucSinFactor = sucId != null && sinFactor.includes(sucId);
      return {
        ...r,
        sucId,
        factor: f,
        scope,
        sinFactor: sucSinFactor,
        tco2e: f != null && !sucSinFactor ? (r.cantidad * f) / 1000 : 0,
      };
    });
}

/**
 * Refrigerantes: no son consumo, son kilos repuestos que emiten directamente por
 * GWP × kg (alcance 1). Viven en la configuración de emisiones, no en registros.
 */
export function emisionesRefrigerantes({ sucursales, emissions, anchor }, filters) {
  const gwp = {};
  for (const r of REFRIGERANTES_CATALOG) gwp[r.id] = r.gwp;
  const meses = mesesDelFiltro(filters, anchor);
  const filas = [];

  for (const suc of sucursales || []) {
    if (!coincideSucursal(filters?.sucursal, suc.nombre)) continue;
    for (const rf of emissions.refrigerantesSucursal?.[suc.id] || []) {
      if (meses && !meses.has(rf.mes)) continue;
      const g = gwp[rf.tipo] || 0;
      filas.push({
        sucId: suc.id,
        sucursal: suc.nombre,
        tipo: rf.tipo,
        gwp: g,
        cargaKg: rf.cargaKg,
        mes: rf.mes,
        tco2e: (rf.cargaKg * g) / 1000,
      });
    }
  }
  return filas;
}

/** Total, por alcance y por categoría. */
export function agregadoEmisiones(ctx, filters) {
  const recs = emisionesPorRegistro(ctx, filters);
  const refs = emisionesRefrigerantes(ctx, filters);

  const byScope = { 1: 0, 2: 0, 3: 0 };
  const byCat = { electricidad: 0, combustible: 0, agua: 0, refrigerantes: 0 };

  for (const r of recs) {
    byScope[r.scope] += r.tco2e;
    byCat[r.type] += r.tco2e;
  }
  for (const r of refs) {
    byScope[1] += r.tco2e;
    byCat.refrigerantes += r.tco2e;
  }

  return { total: byScope[1] + byScope[2] + byScope[3], byScope, byCat, recs, refs };
}

/** Serie mensual de tCO₂e, acotada al período del filtro. */
export function emisionesPorMes(ctx, scopeFilter = "all", filters) {
  const recs = emisionesPorRegistro(ctx, filters);
  const refs = emisionesRefrigerantes(ctx, filters);
  const eje = filters?.period ? periodToMonthKeys(filters.period, ctx.anchor) : monthsWindow(ctx.anchor, 12);
  const incluyeAlcance1 = scopeFilter === "all" || +scopeFilter === 1;

  const data = eje.map((mk) => {
    let v = 0;
    for (const r of recs) {
      if (String(r.date).startsWith(mk) && (scopeFilter === "all" || r.scope === +scopeFilter)) v += r.tco2e;
    }
    if (incluyeAlcance1) {
      for (const r of refs) if (r.mes === mk) v += r.tco2e;
    }
    return v;
  });

  return { months: eje, data };
}

/** tCO₂e por sucursal, marcando las que no tienen factor. */
export function emisionesPorSucursal(ctx, scopeFilter = "all", filters) {
  const recs = emisionesPorRegistro(ctx, filters);
  const refs = emisionesRefrigerantes(ctx, filters);
  const sinFactor = sucursalesSinFactor(ctx.sucursales);
  const incluyeAlcance1 = scopeFilter === "all" || +scopeFilter === 1;

  return (ctx.sucursales || [])
    .filter((suc) => coincideSucursal(filters?.sucursal, suc.nombre))
    .map((suc) => {
      let v = 0;
      for (const r of recs) {
        if (r.sucId === suc.id && (scopeFilter === "all" || r.scope === +scopeFilter)) v += r.tco2e;
      }
      if (incluyeAlcance1) {
        for (const r of refs) if (r.sucId === suc.id) v += r.tco2e;
      }
      return {
        id: suc.id,
        nombre: suc.nombre,
        activa: suc.activa,
        sinFactor: sinFactor.includes(suc.id),
        tco2e: v,
      };
    });
}

/** Emisiones de un año calendario — modo "año base desde los registros". */
export function emisionesDelAnio(ctx, year, sucursalNombre) {
  if (!year) return 0;
  return agregadoEmisiones(ctx, {
    sucursal: sucursalNombre || "all",
    period: `custom:${year}-01:${year}-12`,
  }).total;
}

export function nombresSucursalesSinFactor(sucursales) {
  const byId = {};
  for (const s of sucursales || []) byId[s.id] = s;
  return sucursalesSinFactor(sucursales)
    .map((id) => byId[id])
    .filter((s) => s?.activa)
    .map((s) => s.nombre);
}

/**
 * Overrides marcados para revisión: la empresa cambió su factor base después de
 * que alguien definió un valor propio para una sucursal, así que ese valor puede
 * haber quedado obsoleto.
 */
export function overridesPendientes({ sucursales, emissions }) {
  const byId = {};
  for (const s of sucursales || []) byId[s.id] = s;
  const out = [];

  for (const [sucId, factores] of Object.entries(emissions.factoresSucursal || {})) {
    for (const [key, f] of Object.entries(factores)) {
      if (!f.pendingReview) continue;
      const emp = emissions.factoresEmpresa?.[key];
      out.push({
        sucId,
        sucNombre: byId[sucId]?.nombre || sucId,
        key,
        label: emp?.label || key,
        sucValue: f.value,
        empValue: emp?.value ?? null,
        unit: emp?.unit || "",
      });
    }
  }
  return out;
}

export const SCOPE_COLORS = {
  1: { stroke: "var(--rl-fuel)", fill: "var(--rl-fuel-bg)" },
  2: { stroke: "var(--rl-primary-900)", fill: "var(--rl-primary-50)" },
  3: { stroke: "var(--rl-success-700)", fill: "var(--rl-success-50)" },
};

export const CAT_META = {
  electricidad:  { label: "Electricidad",  icon: "bolt",              color: "var(--rl-primary-900)", bg: "var(--rl-primary-50)" },
  combustible:   { label: "Combustibles",  icon: "local_gas_station", color: "var(--rl-fuel)",        bg: "var(--rl-fuel-bg)" },
  agua:          { label: "Agua",          icon: "water_drop",        color: "var(--rl-success-700)", bg: "var(--rl-success-50)" },
  refrigerantes: { label: "Refrigerantes", icon: "snowflake",         color: "#6366F1",               bg: "#EEF0FE" },
};
