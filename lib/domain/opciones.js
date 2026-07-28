// Opciones de los formularios de configuración y onboarding: sistemas
// eléctricos, tipos de combustible y de agua, usos, unidades, refrigerantes.
// Portado de proto/onboarding.jsx, donde convivía con la UI del wizard aunque
// también lo usa la edición de sucursal.
//
// "__otro" es el valor centinela que habilita el campo de texto libre; el nombre
// real queda en `tipoCustom` / `proveedorCustom`.

import { FUEL_SUBCATS_CATALOG, PROVIDERS } from "./catalog";

export const OTRO = "__otro";

export const SISTEMAS = [
  { value: "SEN", label: "SEN" },
  { value: "loslagos", label: "Los Lagos" },
  { value: "aysen", label: "Aysén" },
  { value: "magallanes", label: "Magallanes" },
];

export const TIPOS_COMBUSTIBLE = [
  { value: "diesel",         label: "Petróleo Diésel", defaultUnit: "L" },
  { value: "kerosene",       label: "Kerosene",        defaultUnit: "L" },
  { value: "gasolina",       label: "Gasolina",        defaultUnit: "L" },
  { value: "fuel-oil",       label: "Fuel Oil",        defaultUnit: "L" },
  { value: "glp",            label: "GLP",             defaultUnit: "kg" },
  { value: "lena",           label: "Leña",            defaultUnit: "kg" },
  { value: "pellets",        label: "Pellets",         defaultUnit: "kg" },
  { value: "astillas",       label: "Astillas",        defaultUnit: "kg" },
  { value: "carbon-vegetal", label: "Carbón vegetal",  defaultUnit: "kg" },
  { value: "briquetas",      label: "Briquetas",       defaultUnit: "kg" },
  { value: "gas-natural",    label: "Gas Natural",     defaultUnit: "m³" },
  { value: OTRO,             label: "Otro…" },
];

export const USOS_COMBUSTIBLE = [
  { value: "estacionario", label: "Estacionario" },
  { value: "movil", label: "Móvil" },
];

export const UNIDADES_COMBUSTIBLE = [
  { value: "L",   label: "Litros (L)" },
  { value: "kg",  label: "Kilogramos (kg)" },
  { value: "m³",  label: "Metros cúbicos (m³)" },
  { value: "gal", label: "Galones (gal)" },
  { value: "t",   label: "Toneladas (t)" },
  { value: "kWh", label: "Kilovatios hora (kWh)" },
];

export const TIPOS_REFRIGERANTE = [
  { value: "R507", label: "R507" },
  { value: "R407A", label: "R407A" },
  { value: OTRO, label: "Otro" },
];

export const TIPOS_AGUA = [
  { value: "potable",    label: "Potable" },
  { value: "gris",       label: "Gris" },
  { value: "industrial", label: "Industrial" },
  { value: OTRO,         label: "Otro…" },
];

export const ITEM_DEFS = {
  electricidad:  { label: "Electricidad",  icon: "bolt",              color: "var(--rl-primary-900)", bg: "var(--rl-primary-50)" },
  combustible:   { label: "Combustible",   icon: "local_gas_station", color: "var(--rl-fuel)",        bg: "var(--rl-fuel-bg)" },
  agua:          { label: "Agua",          icon: "water_drop",        color: "var(--rl-success-700)", bg: "var(--rl-success-50)" },
  refrigerantes: { label: "Refrigerantes", icon: "snowflake",         color: "#0891B2",               bg: "#ECFEFF" },
};

const labelOf = (list) => (v) => list.find((o) => o.value === v)?.label || v;

export const sistemaLabel = labelOf(SISTEMAS);
export const usoLabel = labelOf(USOS_COMBUSTIBLE);
export const unidadLabel = labelOf(UNIDADES_COMBUSTIBLE);

export const tipoCombLabel = (v, custom) =>
  v === OTRO ? custom || "Otro" : labelOf(TIPOS_COMBUSTIBLE)(v);
export const tipoAguaLabel = (v, custom) =>
  v === OTRO ? custom || "Otro" : labelOf(TIPOS_AGUA)(v);
export const tipoRefriLabel = (v) => (v === OTRO ? "Otro" : labelOf(TIPOS_REFRIGERANTE)(v));
export const proveedorDisplay = (p, custom) =>
  p === OTRO ? custom || "Proveedor personalizado" : p || "—";

/** Opciones de proveedor para un tipo, con la salida "Otro". */
export const providerOpts = (type) => [
  ...(PROVIDERS[type] || []).map((p) => ({ value: p, label: p })),
  { value: OTRO, label: "Otro" },
];

/** Unidades admitidas por un combustible según el catálogo. */
export function fuelUnitsForTipo(tipo) {
  if (!tipo || tipo === OTRO) return UNIDADES_COMBUSTIBLE;
  const cat = FUEL_SUBCATS_CATALOG[tipo];
  if (!cat) return UNIDADES_COMBUSTIBLE;
  return UNIDADES_COMBUSTIBLE.filter((u) => cat.units.includes(u.value));
}

export function fuelDefaultUnit(tipo) {
  if (!tipo || tipo === OTRO) return "";
  return FUEL_SUBCATS_CATALOG[tipo]?.defaultUnit || "";
}
