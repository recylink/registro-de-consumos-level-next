// Consultas sobre la configuración de sucursales: qué subcategorías existen, qué
// proveedor corresponde, a qué sucursal pertenece un número de cliente.
//
// Portado de proto/state.jsx. Cambio de firma: allá cada helper recibía el
// `state` global completo; acá reciben la lista de sucursales. Son funciones
// puras sobre datos, no consultas al estado de la app.

import { FUEL_SUBCATS_CATALOG, INITIAL_SUBCATS, PROVIDERS, TYPES } from "./catalog";

export const ITEM_TYPES = ["electricidad", "combustible", "agua", "refrigerantes"];

export function emptyItems() {
  return {
    electricidad: { activo: false, subcats: [] },
    combustible: { activo: false, subcats: [] },
    agua: { activo: false, subcats: [] },
    refrigerantes: { activo: false, subcats: [] },
  };
}

/** Nombres de las sucursales activas. */
export function activeSucNames(sucursales) {
  return (sucursales || []).filter((s) => s.activa).map((s) => s.nombre);
}

const slug = (name) => name.toLowerCase().replace(/\s+/g, "-");

/** Subcategoría de agua configurada → opción con id estable. */
export function aguaSubcatFromConfig(sc) {
  if (!sc?.tipo) return null;
  if (sc.tipo === "__otro") {
    const name = (sc.tipoCustom || "").trim();
    if (!name) return null;
    return { id: "otro:" + slug(name), label: name, source: "config" };
  }
  const labels = { potable: "Potable", gris: "Gris", industrial: "Industrial" };
  return { id: sc.tipo, label: labels[sc.tipo] || sc.tipo, source: "config" };
}

/** Subcategoría de combustible configurada → opción, con su unidad. */
export function combustibleSubcatFromConfig(sc) {
  if (!sc?.tipo) return null;
  if (sc.tipo === "__otro") {
    const name = (sc.tipoCustom || "").trim();
    if (!name) return null;
    return { id: "otro:" + slug(name), label: name, unidad: sc.unidad || "", source: "config" };
  }
  const cat = FUEL_SUBCATS_CATALOG[sc.tipo];
  return {
    id: sc.tipo,
    label: cat ? cat.label : sc.tipo,
    unidad: sc.unidad || (cat ? cat.defaultUnit : ""),
    source: "config",
  };
}

/**
 * Subcategorías disponibles para un tipo de consumo. Agua y combustible salen de
 * lo configurado; con `sucursalName` se acota a esa sucursal (registro
 * individual), sin él se agregan las de todas las activas (dashboard).
 */
export function getSubcatsFor(sucursales, type, sucursalName) {
  if (type === "agua" || type === "combustible") {
    const fromCfg = type === "agua" ? aguaSubcatFromConfig : combustibleSubcatFromConfig;
    const seen = new Map();
    for (const s of sucursales || []) {
      if (!s.activa || !s.items?.[type]?.activo) continue;
      if (sucursalName && s.nombre !== sucursalName) continue;
      for (const sc of s.items[type].subcats || []) {
        const opt = fromCfg(sc);
        if (opt && !seen.has(opt.id)) seen.set(opt.id, opt);
      }
    }
    return [...seen.values()];
  }
  return INITIAL_SUBCATS[type] || [];
}

/**
 * Unidad de un consumo. Combustible usa la unidad configurada en la
 * subcategoría de la sucursal; el resto, la estándar del tipo.
 */
export function getEntryUnit(sucursales, sucursalName, type, subcatId) {
  if (type === "combustible" && subcatId) {
    const opt = getSubcatsFor(sucursales, "combustible", sucursalName).find((o) => o.id === subcatId);
    if (opt?.unidad) return opt.unidad;
  }
  return TYPES[type] ? TYPES[type].unit : "";
}

// "__otro" guarda el nombre real en proveedorCustom.
function providerName(sc) {
  if (!sc) return "";
  if (sc.proveedor === "__otro") return (sc.proveedorCustom || "").trim();
  return sc.proveedor || "";
}

/**
 * Proveedor por defecto para (sucursal, tipo, subcategoría) según la config.
 * Si no hay coincidencia exacta cae al primer proveedor configurado del tipo.
 */
export function getConfiguredProvider(sucursales, sucursalName, type, subcatId) {
  if (!sucursalName || !type) return "";
  const suc = (sucursales || []).find((s) => s.activa && s.nombre === sucursalName);
  if (!suc?.items?.[type]?.activo) return "";
  const subcats = suc.items[type].subcats || [];

  if (type === "agua" && subcatId) {
    const match = subcats.find((sc) => aguaSubcatFromConfig(sc)?.id === subcatId);
    if (match) return providerName(match);
  }
  if (type === "combustible" && subcatId) {
    const match = subcats.find((sc) => sc.tipo === subcatId);
    if (match) return providerName(match);
  }
  for (const sc of subcats) {
    const p = providerName(sc);
    if (p) return p;
  }
  return "";
}

/**
 * Opciones de proveedor para un Select: los configurados en la sucursal primero,
 * después el catálogo estático del tipo. Sin repetidos.
 */
export function getProviderOptionsFor(sucursales, sucursalName, type) {
  if (!type) return [];
  const out = [];
  const seen = new Set();
  const push = (name) => {
    const v = (name || "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  const suc = (sucursales || []).find((s) => s.activa && s.nombre === sucursalName);
  if (suc?.items?.[type]?.activo) {
    for (const sc of suc.items[type].subcats) push(providerName(sc));
  }
  for (const p of PROVIDERS[type] || []) push(p);
  return out;
}

/**
 * Normaliza un número de cliente para comparar: sin puntos ni espacios y sin
 * dígito verificador ("12.345.678-9" → "12345678"), así calza aunque la boleta
 * lo traiga y la config no, o al revés.
 */
export function normNumCliente(s) {
  let t = String(s || "").trim().toLowerCase().replace(/[\s.]/g, "");
  t = t.replace(/-[0-9k]$/, "");
  return t.replace(/[^a-z0-9]/g, "");
}

/**
 * Busca a qué sucursal/subcategoría/proveedor corresponde un número de cliente
 * extraído de una boleta. Devuelve null si no hay coincidencia.
 */
export function resolveByNumCliente(sucursales, numeroCliente, type) {
  const target = normNumCliente(numeroCliente);
  if (!target) return null;
  const types = type ? [type] : ITEM_TYPES;
  for (const suc of sucursales || []) {
    if (!suc.activa) continue;
    for (const t of types) {
      const item = suc.items?.[t];
      if (!item?.activo) continue;
      for (const sc of item.subcats || []) {
        if (normNumCliente(sc.numCliente) !== target) continue;
        let subcat = null;
        if (t === "agua") subcat = aguaSubcatFromConfig(sc)?.id ?? null;
        else if (t === "combustible" || t === "refrigerantes") subcat = sc.tipo || null;
        return { sucursal: suc.nombre, type: t, subcat, provider: providerName(sc) };
      }
    }
  }
  return null;
}
