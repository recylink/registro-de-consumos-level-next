// ¿Qué le falta cargar a cada sucursal en un mes? Cada subcategoría configurada
// y activa cuenta como una casilla que debería tener al menos un registro.
// Extraído de proto/landing.jsx, donde el cálculo vivía dentro del componente;
// la matriz de carga hace lo mismo por mes.

import { aguaSubcatFromConfig } from "./sucursales";
import { ITEM_TYPES } from "./sucursales";

/** ¿Este registro corresponde a esta subcategoría configurada? */
function matchesSubcat(record, type, sc) {
  if (type === "electricidad") return true; // no se subdivide
  if (type === "agua") {
    const opt = aguaSubcatFromConfig(sc);
    return !!opt && record.subcat === opt.id;
  }
  return record.subcat === sc.tipo;
}

/**
 * Casillas cargadas vs configuradas de una sucursal en un mes.
 * `monthKey` en formato YYYY-MM.
 */
export function estadoCargaSucursal(suc, records, monthKey) {
  let configured = 0;
  let loaded = 0;
  for (const type of ITEM_TYPES) {
    const cfg = suc.items?.[type];
    if (!cfg?.activo) continue;
    for (const sc of cfg.subcats || []) {
      configured++;
      const hit = records.some(
        (r) =>
          r.estado !== "eliminada" &&
          r.sucursal === suc.nombre &&
          r.type === type &&
          String(r.date).startsWith(monthKey) &&
          matchesSubcat(r, type, sc),
      );
      if (hit) loaded++;
    }
  }
  return { configured, loaded };
}

/** Semáforo de una sucursal: etiqueta + color del punto. */
export function badgeCarga({ configured, loaded }) {
  if (configured === 0) return { label: "Sin config", dot: "var(--rl-gray-400)" };
  if (loaded === 0) return { label: "Sin carga", dot: "var(--rl-error-500)" };
  if (loaded === configured) return { label: "Al día", dot: "var(--rl-success-500)" };
  return { label: `${loaded}/${configured}`, dot: "var(--rl-warning-500)" };
}

/** Estado de todas las sucursales activas, más el resumen al día / pendientes. */
export function estadoCarga(sucursales, records, monthKey) {
  const items = (sucursales || [])
    .filter((s) => s.activa)
    .map((suc) => {
      const conteo = estadoCargaSucursal(suc, records, monthKey);
      return { suc, ...conteo, badge: badgeCarga(conteo) };
    });
  const alDia = items.filter((s) => s.configured > 0 && s.loaded === s.configured).length;
  return { items, alDia, total: items.length, pendientes: items.length - alDia };
}
