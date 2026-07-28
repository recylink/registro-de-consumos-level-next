import "server-only";

// Configuración de la instancia. A diferencia del prototipo (donde RC_CONFIG
// vivía en proto/sync.jsx y viajaba al navegador con endpoint e IDs de Drive a
// la vista), acá nada de esto sale del servidor: `server-only` hace fallar el
// build si algún componente cliente importa este módulo.

// Esta instancia no pertenece a un cliente: es la versión formal de referencia.
// El valor se escribe en la columna "Empresa" de cada fila del Sheet.
export const EMPRESA = "NEXT";

export const SHEETS = {
  COMBUSTIBLE: "Combustible",
  ELECTRICIDAD: "Electricidad",
  AGUA: "Agua",
  FOTOS: "Fotos",
  // Módulo Medidores (lecturas físicas).
  MED_MEDIDORES: "Medidores",
  MED_LECTURAS: "Lecturas Medidor",
  MED_PRECIOS: "Precios Medidor",
};

export function appsScriptUrl() {
  return String(process.env.APPS_SCRIPT_URL || "").trim();
}

// URL de la planilla, solo para el link "ver planilla" de la UI. Opcional.
export function spreadsheetUrl() {
  return String(process.env.SPREADSHEET_URL || "").trim();
}

// Sin endpoint la app corre en "modo local": las lecturas devuelven vacío y las
// escrituras son no-ops declaradas. Sirve para desarrollar sin tocar el Sheet.
export function isConfigured() {
  return appsScriptUrl().includes("script.google.com");
}
