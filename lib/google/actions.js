import "server-only";
import { HOJAS_REGISTROS, SHEETS } from "../instance";
import { leerFilas, leerHoja, leerVariasHojas } from "./sheets-api";

// Traducción action por action del Apps Script (apps-script.gs) al SDK de Google
// APIs. Cada entrada replica la firma Y la forma de respuesta de su equivalente,
// porque los consumidores de lib/sheets/ no se enteran de por dónde salió el dato.
//
// Sólo lo que esté acá puede migrarse; el resto sigue yendo al /exec. La lista de
// actions activas la decide RC_SDK_ACTIONS (ver lib/backend-flag.js), no este
// archivo: implementar no es lo mismo que habilitar.
//
// Al agregar una action, anotar de qué función del .gs viene y con qué modo de
// lectura (crudo / display), que es lo único que no se puede deducir después.

// ----- Lecturas -----------------------------------------------------------

/**
 * readAll (apps-script.gs:217). Un objeto por hoja, CON encabezado — readRecords
 * hace el slice(1) del lado del consumidor. Display values: los parsers de
 * lib/domain/parse.js leen "20.440" y "31-07-26", no números ni seriales.
 */
async function read() {
  return leerVariasHojas(HOJAS_REGISTROS, { crudo: false });
}

/**
 * getConfigValue (apps-script.gs:310). Store key/valor sobre la hoja "Config":
 * columna A la clave, columna B el JSON. Valores crudos, y un JSON ilegible
 * devuelve null en vez de lanzar — así estaba y así se mantiene, porque
 * drive-folders.js trata el null como "sin configurar".
 */
async function getConfig({ key }) {
  if (!key) return { value: null };
  const filas = await leerFilas(SHEETS.CONFIG, { crudo: true });
  for (const fila of filas) {
    if (fila[0] === key) {
      try {
        return { value: JSON.parse(fila[1]) };
      } catch {
        return { value: null };
      }
    }
  }
  return { value: null };
}

/** getConfigSucursales (apps-script.gs:352). Sin encabezado, valores crudos. */
async function getConfigSucursales() {
  return { rows: await leerFilas(SHEETS.CONFIG_SUCURSALES, { crudo: true }) };
}

/** getEmissions (apps-script.gs:412). Sin encabezado, valores crudos. */
async function getEmissions() {
  return { rows: await leerFilas(SHEETS.EMISIONES, { crudo: true }) };
}

/** getFotos (apps-script.gs:493). Sin encabezado, display values. */
async function getFotos() {
  return { rows: await leerFilas(SHEETS.FOTOS, { crudo: false }) };
}

/**
 * getSheetRows (apps-script.gs:506) para las tres hojas de Medidores. Display
 * values: `medidores-calc.js` compara lecturas como texto y el precio llega
 * formateado.
 */
const getMedidores = () => leerFilas(SHEETS.MED_MEDIDORES).then((rows) => ({ rows }));
const getLecturasMedidor = () => leerFilas(SHEETS.MED_LECTURAS).then((rows) => ({ rows }));
const getPreciosMedidor = () => leerFilas(SHEETS.MED_PRECIOS).then((rows) => ({ rows }));

// ----- Registro -----------------------------------------------------------
// Bloque A (lecturas). Los bloques B–G se agregan acá a medida que se migran:
//   B  append · update · updateCells
//   C  setConfig · setEmissions · setConfigSucursales · setMedidores ·
//      setLecturasMedidor · setPreciosMedidor
//   D  upsertSucursal · deleteSucursal
//   E  upload · move · deleteFile      (bloqueado: cuota de Drive de la SA)
//   F  notifyFotoPending               (bloqueado: MailApp no existe en el SDK)
//   G  setup · init
//
// `ping` a propósito NO está acá: /api/health prueba los dos backends por
// separado y usa sdkPing() para el lado del SDK.

/** Lecturas: se sirven por GET y se cachean con tag. */
export const SDK_GET = {
  read,
  getConfig,
  getConfigSucursales,
  getEmissions,
  getFotos,
  getMedidores,
  getLecturasMedidor,
  getPreciosMedidor,
};

/** Mutaciones: se sirven por POST y nunca se cachean. */
export const SDK_POST = {};

export function sdkImplementa(action) {
  return Object.hasOwn(SDK_GET, action) || Object.hasOwn(SDK_POST, action);
}

/** Nombres implementados, para el diagnóstico de /api/health. */
export function sdkActionsImplementadas() {
  return [...Object.keys(SDK_GET), ...Object.keys(SDK_POST)].sort();
}
