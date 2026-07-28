// Catálogo estático del dominio: tipos de consumo, subcategorías y proveedores.
// Portado desde proto/state.jsx. Isomorfo a propósito — lo usan tanto los
// componentes de servidor como los de cliente, así que no lleva `server-only`.

export const TYPES = {
  electricidad: { id: "electricidad", label: "Electricidad", unit: "kWh", icon: "bolt",               color: "var(--rl-primary-900)", bg: "var(--rl-primary-50)" },
  combustible:  { id: "combustible",  label: "Combustible",  unit: "L",   icon: "local_gas_station",  color: "var(--rl-fuel)",        bg: "var(--rl-fuel-bg)" },
  agua:         { id: "agua",         label: "Agua",         unit: "m³",  icon: "water_drop",         color: "var(--rl-success-700)", bg: "var(--rl-success-50)" },
};

export const INITIAL_SUBCATS = {
  electricidad: [],
  combustible: [
    { id: "diesel",      label: "Petróleo Diésel", source: "predef" },
    { id: "kerosene",    label: "Kerosene",        source: "predef" },
    { id: "glp",         label: "GLP",             source: "predef" },
    { id: "gas-natural", label: "Gas Natural",     source: "predef" },
  ],
  agua: [
    { id: "potable", label: "Agua Potable", source: "predef" },
    { id: "gris",    label: "Agua Gris",    source: "predef" },
    { id: "riego",   label: "Riego",        source: "custom" },
  ],
};

export const PROVIDERS = {
  electricidad: ["CGE", "Enel", "Chilquinta", "Grupo Saesa", "Edelmag"],
  combustible:  ["Copec", "Shell", "Petrobras", "Esmax", "Enex", "YPF", "Iconstruye Petróleo", "Lipigas", "Abastible", "Gasco", "Metrogas", "Gasvalpo"],
  agua:         ["Aguas Andinas", "SMAPA", "Esval", "Essbio", "Aguas del Altiplano", "Aguas Antofagasta", "Aguas del Valle", "Aguas Araucanía", "Suralis", "Aguas Magallanes"],
};

// Subcategorías de combustible: unidad por defecto y unidades admitidas.
export const FUEL_SUBCATS_CATALOG = {
  "diesel":         { label: "Petróleo Diésel", defaultUnit: "L",  units: ["L", "gal"] },
  "kerosene":       { label: "Kerosene",        defaultUnit: "L",  units: ["L", "gal"] },
  "gasolina":       { label: "Gasolina",        defaultUnit: "L",  units: ["L", "gal"] },
  "fuel-oil":       { label: "Fuel Oil",        defaultUnit: "L",  units: ["L", "gal"] },
  "glp":            { label: "GLP",             defaultUnit: "kg", units: ["kg", "L", "m³"] },
  "lena":           { label: "Leña",            defaultUnit: "kg", units: ["kg", "t"] },
  "pellets":        { label: "Pellets",         defaultUnit: "kg", units: ["kg", "t"] },
  "astillas":       { label: "Astillas",        defaultUnit: "kg", units: ["kg", "t"] },
  "carbon-vegetal": { label: "Carbón vegetal",  defaultUnit: "kg", units: ["kg", "t"] },
  "briquetas":      { label: "Briquetas",       defaultUnit: "kg", units: ["kg", "t"] },
  "gas-natural":    { label: "Gas Natural",     defaultUnit: "m³", units: ["m³", "kWh"] },
};

// Reconstruye el label desde un id custom "otro:<slug>".
function labelFromSlug(id) {
  return id
    .slice(5)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** id de subcategoría → etiqueta legible (la que se escribe en el Sheet). */
export function subcatLabel(type, id) {
  if (!id) return null;
  if (type === "agua") {
    if (id.startsWith("otro:")) return labelFromSlug(id);
    return { potable: "Potable", gris: "Gris", industrial: "Industrial" }[id] || id;
  }
  if (type === "combustible") {
    if (id.startsWith("otro:")) return labelFromSlug(id);
    return FUEL_SUBCATS_CATALOG[id] ? FUEL_SUBCATS_CATALOG[id].label : id;
  }
  const found = (INITIAL_SUBCATS[type] || []).find((s) => s.id === id);
  return found ? found.label : id;
}
