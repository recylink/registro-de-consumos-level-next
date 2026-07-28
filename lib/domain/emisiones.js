// Catálogo de emisiones GEI y semilla del estado de emisiones.
// Portado de proto/state.jsx (bloque "Emisiones GEI (Huella Chile)").

export const SCOPES = {
  1: { id: 1, label: "Alcance 1", desc: "Emisiones directas", color: "var(--rl-fuel)",        bg: "var(--rl-fuel-bg)" },
  2: { id: 2, label: "Alcance 2", desc: "Energía indirecta",  color: "var(--rl-primary-900)", bg: "var(--rl-primary-50)" },
  3: { id: 3, label: "Alcance 3", desc: "Otras indirectas",   color: "var(--rl-success-700)", bg: "var(--rl-success-50)" },
};

// Factores base de empresa. La clave de combustible coincide con `subcat` del
// registro; electricidad y agua usan su propio tipo.
export const EMISSION_FACTOR_CATALOG = {
  electricidad: { label: "Electricidad — SEN", value: 0.4156, unit: "kgCO₂e/kWh", scope: 2, type: "electricidad", fuente: "Coordinador Eléctrico Nacional 2023" },
  diesel:       { label: "Petróleo Diésel",    value: 2.696,  unit: "kgCO₂e/L",   scope: 1, type: "combustible",  fuente: "IPCC 2006 · Huella Chile" },
  kerosene:     { label: "Kerosene",           value: 2.538,  unit: "kgCO₂e/L",   scope: 1, type: "combustible",  fuente: "IPCC 2006 · Huella Chile" },
  gasolina:     { label: "Gasolina",           value: 2.271,  unit: "kgCO₂e/L",   scope: 1, type: "combustible",  fuente: "IPCC 2006 · Huella Chile" },
  "fuel-oil":   { label: "Fuel Oil",           value: 3.066,  unit: "kgCO₂e/L",   scope: 1, type: "combustible",  fuente: "IPCC 2006 · Huella Chile" },
  glp:          { label: "GLP",                value: 2.954,  unit: "kgCO₂e/kg",  scope: 1, type: "combustible",  fuente: "IPCC 2006 · Huella Chile" },
  lena:         { label: "Leña",               value: 0.024,  unit: "kgCO₂e/kg",  scope: 1, type: "combustible",  fuente: "IPCC 2006 (no biogénico)" },
  pellets:      { label: "Pellets",            value: 0.045,  unit: "kgCO₂e/kg",  scope: 1, type: "combustible",  fuente: "IPCC 2006 (no biogénico)" },
  "gas-natural":{ label: "Gas Natural",        value: 2.022,  unit: "kgCO₂e/m³",  scope: 1, type: "combustible",  fuente: "IPCC 2006 · Huella Chile" },
  agua:         { label: "Agua potable",       value: 0.348,  unit: "kgCO₂e/m³",  scope: 3, type: "agua",         fuente: "Huella Chile · cadena de suministro" },
};

// GWP a 100 años (AR5).
export const REFRIGERANTES_CATALOG = [
  { id: "r22",   label: "R-22",   gwp: 1810 },
  { id: "r410a", label: "R-410A", gwp: 2088 },
  { id: "r134a", label: "R-134a", gwp: 1430 },
  { id: "r404a", label: "R-404A", gwp: 3922 },
  { id: "r507",  label: "R-507",  gwp: 3985 },
  { id: "r32",   label: "R-32",   gwp: 675 },
];

/**
 * Estado inicial de emisiones: solo los factores base de empresa y una meta por
 * defecto. Los overrides y refrigerantes por sucursal se crean en uso.
 *
 * `baseEmissions` son las tCO₂e del inventario del año base; sin ese dato no se
 * calcula reducción real. `baseMode` "auto" usa las emisiones registradas en el
 * sistema para el año base, "manual" usa `baseEmissions`.
 */
export function seedEmissions() {
  const factoresEmpresa = {};
  for (const [k, v] of Object.entries(EMISSION_FACTOR_CATALOG)) factoresEmpresa[k] = { ...v };
  return {
    factoresEmpresa,
    factoresSucursal: {},
    refrigerantesSucursal: {},
    metas: {
      empresa: { absoluta: "", relativa: 30, anioBase: 2023, baseEmissions: "", baseMode: "manual" },
      sucursales: {},
    },
  };
}

/**
 * Aplica lo guardado sobre la semilla. Los valores persistidos son solo números:
 * label, unidad, alcance y fuente vienen siempre del catálogo, así que corregir
 * un texto del catálogo no exige migrar la planilla.
 */
export function mergeEmissions(src) {
  const base = seedEmissions();
  if (!src || typeof src !== "object") return base;

  if (src.factoresEmpresa) {
    for (const k of Object.keys(base.factoresEmpresa)) {
      const s = src.factoresEmpresa[k];
      if (s && typeof s.value === "number") base.factoresEmpresa[k].value = s.value;
    }
  }
  if (src.factoresSucursal && typeof src.factoresSucursal === "object") {
    base.factoresSucursal = src.factoresSucursal;
  }
  if (src.refrigerantesSucursal && typeof src.refrigerantesSucursal === "object") {
    base.refrigerantesSucursal = src.refrigerantesSucursal;
  }
  if (src.metas && typeof src.metas === "object") {
    base.metas = {
      empresa: { ...base.metas.empresa, ...(src.metas.empresa || {}) },
      sucursales: { ...base.metas.sucursales, ...(src.metas.sucursales || {}) },
    };
  }
  return base;
}
