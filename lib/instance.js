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
  // Estas tres las tenía el Apps Script en variables sueltas (CONFIG_SUC_SHEET,
  // EMISSIONS_SHEET, y "Config" escrito a mano en cuatro lugares). Al migrar al
  // SDK pasan acá, para que el nombre de la hoja tenga un solo dueño.
  CONFIG: "Config",
  CONFIG_SUCURSALES: "Config Sucursales",
  EMISIONES: "Emisiones",
};

/** Las tres hojas de Registros, en el orden en que las leía `readAll`. */
export const HOJAS_REGISTROS = [SHEETS.COMBUSTIBLE, SHEETS.ELECTRICIDAD, SHEETS.AGUA];

export function appsScriptUrl() {
  return String(process.env.APPS_SCRIPT_URL || "").trim();
}

/**
 * ID de la planilla, para el SDK de Google APIs. El Apps Script no lo necesitaba
 * porque operaba sobre la planilla que lo contenía; el SDK habla desde afuera y
 * tiene que decir sobre cuál.
 *
 * Se acepta la URL completa por comodidad: es lo que uno copia del navegador.
 */
export function spreadsheetId() {
  const raw = String(process.env.SPREADSHEET_ID || "").trim();
  if (!raw) return "";
  const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : raw;
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
