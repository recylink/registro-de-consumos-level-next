import "server-only";
import { HOJAS_REGISTROS, SHEETS } from "../instance";
import {
  ENCABEZADOS,
  ENCABEZADOS_CONFIG,
  ENCABEZADOS_CONFIG_SUCURSALES,
  ENCABEZADOS_EMISIONES,
} from "./headers";
import {
  agregarFilas,
  borrarFilas,
  crearHoja,
  escribirCeldas,
  existeHoja,
  hojas,
  leerFilas,
  leerHoja,
  leerVariasHojas,
  normalizarAncho,
  reemplazarHoja,
} from "./sheets-api";

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

// ----- Escrituras puntuales (bloque B) ------------------------------------

/**
 * appendRows (apps-script.gs:228). Filas al final de una hoja.
 *
 * Dos diferencias con el original, las dos a favor:
 *
 * 1. El Apps Script leía `getLastRow()` y escribía en la fila siguiente — dos
 *    operaciones con una carrera en el medio, que es la razón por la que
 *    `withLock` existía (apps-script.gs:114). `values.append` con INSERT_ROWS
 *    resuelve el destino del lado del servidor, así que dos appends concurrentes
 *    ya no pueden pisarse aunque no haya lock.
 * 2. Escribe con USER_ENTERED, que es como se comporta `setValues()` — medido con
 *    /api/migracion/probe-escritura, no supuesto. Ver MODO_ESCRITURA.
 */
async function append({ sheet, values }) {
  if (!sheet) throw new Error("sheet name missing");
  const filas = values || [];
  if (!filas.length) return { ok: true, appended: 0 };
  if (!(await existeHoja(sheet))) await crearHoja(sheet, ENCABEZADOS[sheet]);
  await agregarFilas(sheet, filas);
  return { ok: true, appended: filas.length };
}

/**
 * updateCell (apps-script.gs:254). Una celda. Los mensajes de error son textuales
 * del original: `flows.js` y la UI los muestran tal cual.
 */
async function update({ sheet, row, col, value }) {
  if (!sheet) throw new Error("sheet name missing");
  if (!row || !col) throw new Error("row/col missing");
  if (!(await existeHoja(sheet))) throw new Error("sheet not found: " + sheet);
  await escribirCeldas(sheet, [{ row, col, value }]);
  return { ok: true };
}

/**
 * updateCells (apps-script.gs:243). Varias celdas de una misma hoja en un
 * request. Existía porque completar una foto toca 11 celdas y con `update` eran
 * 11 viajes al /exec; acá es un solo values.batchUpdate.
 *
 * Las celdas sin row o col se ignoran en silencio, igual que el original.
 */
async function updateCells({ sheet, cells }) {
  if (!sheet) throw new Error("sheet name missing");
  const celdas = cells || [];
  if (!celdas.length) return { ok: true, updated: 0 };
  if (!(await existeHoja(sheet))) throw new Error("sheet not found: " + sheet);
  await escribirCeldas(sheet, celdas);
  // `updated` cuenta las celdas RECIBIDAS, no las escritas: una celda sin row o
  // col se ignora pero sigue sumando. Es lo que hacía el original
  // (apps-script.gs:165 cuenta `body.cells.length`) y se replica para no cambiar
  // la respuesta, aunque el número sea optimista.
  return { ok: true, updated: celdas.length };
}

// ----- Reescrituras (bloque C) --------------------------------------------

/**
 * setConfigValue (apps-script.gs:324). Store key/valor: busca la clave y actualiza
 * su celda, o agrega la fila si no estaba. No es una reescritura total, aunque
 * viva en este bloque.
 */
async function setConfig({ key, value }) {
  if (!key) throw new Error("key missing");
  if (!(await existeHoja(SHEETS.CONFIG))) {
    await crearHoja(SHEETS.CONFIG, ENCABEZADOS_CONFIG);
  }
  const json = JSON.stringify(value);
  const filas = await leerHoja(SHEETS.CONFIG, { crudo: true });
  // Desde la fila 2: la 1 es el encabezado.
  for (let i = 1; i < filas.length; i++) {
    if (filas[i][0] === key) {
      await escribirCeldas(SHEETS.CONFIG, [{ row: i + 1, col: 2, value: json }]);
      return { ok: true };
    }
  }
  await agregarFilas(SHEETS.CONFIG, [[key, json]]);
  return { ok: true };
}

/**
 * setConfigSucursales (apps-script.gs:360).
 *
 * El original escribía el rango con el ancho exacto del encabezado, así que
 * CUALQUIER fila de largo distinto tumbaba el guardado completo con un mensaje de
 * Google que no dice qué fila. Acá se rellenan las cortas y se rechazan las
 * largas; ver normalizarAncho para por qué la asimetría.
 */
async function setConfigSucursales({ rows }) {
  const filas = normalizarAncho(rows || [], ENCABEZADOS_CONFIG_SUCURSALES.length, "setConfigSucursales");
  await reemplazarHoja(SHEETS.CONFIG_SUCURSALES, ENCABEZADOS_CONFIG_SUCURSALES, filas);
  return { ok: true };
}

/** setEmissions (apps-script.gs:420). Mismo criterio de ancho. */
async function setEmissions({ rows }) {
  const filas = normalizarAncho(rows || [], ENCABEZADOS_EMISIONES.length, "setEmissions");
  await reemplazarHoja(SHEETS.EMISIONES, ENCABEZADOS_EMISIONES, filas);
  return { ok: true };
}

/**
 * setSheetRows (apps-script.gs:514) para las tres hojas de Medidores. El original
 * ya normalizaba el ancho al del encabezado.
 */
function reemplazoDe(hoja) {
  return async ({ rows }) => {
    const encabezados = ENCABEZADOS[hoja];
    const filas = encabezados
      ? normalizarAncho(rows || [], encabezados.length, hoja)
      : rows || [];
    await reemplazarHoja(hoja, encabezados, filas);
    return { ok: true };
  };
}

const setMedidores = reemplazoDe(SHEETS.MED_MEDIDORES);
const setLecturasMedidor = reemplazoDe(SHEETS.MED_LECTURAS);
const setPreciosMedidor = reemplazoDe(SHEETS.MED_PRECIOS);

// ----- Filas por sucursal (bloque D) --------------------------------------

/** Hoja "Config Sucursales" con su encabezado. Equivale a _configSucSheet (apps-script.gs:371). */
async function asegurarConfigSucursales() {
  if (!(await existeHoja(SHEETS.CONFIG_SUCURSALES))) {
    await crearHoja(SHEETS.CONFIG_SUCURSALES, ENCABEZADOS_CONFIG_SUCURSALES);
  }
}

/** Índices (0-based, encabezado incluido) de las filas de una sucursal. */
async function filasDeSucursal(id) {
  const filas = await leerHoja(SHEETS.CONFIG_SUCURSALES, { crudo: true });
  const out = [];
  for (let i = 1; i < filas.length; i++) {
    if (String(filas[i][0]) === String(id)) out.push(i);
  }
  return out;
}

/**
 * upsertSucursal (apps-script.gs:394). Reemplaza SOLO las filas de una sucursal.
 *
 * ORDEN INVERTIDO, por lo mismo que en reemplazarHoja: el original borraba y
 * después escribía, y sin lock ese orden puede dejar a la sucursal sin ninguna
 * fila si la escritura falla. Acá se agregan primero las nuevas y después se
 * borran las viejas, así que el peor caso son filas duplicadas —visibles y
 * arreglables volviendo a guardar— en vez de una sucursal desaparecida.
 *
 * Los índices a borrar se calculan ANTES de agregar. Es lo que hace que el orden
 * invertido funcione: si se calcularan después, el borrado se llevaría también las
 * filas recién escritas, porque comparten el mismo Sucursal ID.
 *
 * El estado final es el mismo que dejaba el original: las filas nuevas quedan al
 * final, porque borrar filas de arriba no cambia el orden relativo de las que
 * quedan.
 */
async function upsertSucursal({ id, rows }) {
  if (!id) throw new Error("sucursal id missing");
  await asegurarConfigSucursales();
  const viejas = await filasDeSucursal(id);
  const nuevas = normalizarAncho(
    rows || [],
    ENCABEZADOS_CONFIG_SUCURSALES.length,
    "upsertSucursal",
  );
  if (nuevas.length) await agregarFilas(SHEETS.CONFIG_SUCURSALES, nuevas);
  if (viejas.length) await borrarFilas(SHEETS.CONFIG_SUCURSALES, viejas);
  return { ok: true };
}

/** deleteSucursalRows (apps-script.gs:383). Borra todas las filas de una sucursal. */
async function deleteSucursal({ id }) {
  if (!id) throw new Error("sucursal id missing");
  await asegurarConfigSucursales();
  const viejas = await filasDeSucursal(id);
  if (viejas.length) await borrarFilas(SHEETS.CONFIG_SUCURSALES, viejas);
  return { ok: true };
}

// ----- Provisión (bloque G) -----------------------------------------------

/**
 * ensureSheets (apps-script.gs:297). Crea las hojas que falten, con su
 * encabezado. Idempotente: las que ya están no se tocan.
 *
 * Recorre exactamente las mismas 9 hojas que `WEB_CFG.HEADERS` del original, y no
 * más. "Config", "Config Sucursales" y "Emisiones" quedan afuera a propósito: el
 * Apps Script tampoco las creaba acá, las crean sus propios setters la primera vez
 * que escriben. Por eso viven en exports aparte de `headers.js`.
 *
 * `setup` NO está migrada. Su razón de ser es crear el árbol de ~25 carpetas en
 * Drive y dejar los IDs en la hoja "Config"; migrar solo su mitad de Sheets daría
 * un `setup` que responde ok sin haber creado ninguna carpeta, que es peor que no
 * migrarlo. Queda con el bloque E, esperando la definición de Workspace.
 */
async function init() {
  const presentes = new Set((await hojas()).map((h) => h.titulo));
  const creadas = [];
  for (const [nombre, encabezados] of Object.entries(ENCABEZADOS)) {
    if (!presentes.has(nombre)) {
      await crearHoja(nombre, encabezados);
      creadas.push(nombre);
    }
  }
  if (creadas.length) console.warn("[rc:sheets] init creó hojas:", creadas);
  // El original devolvía { ok: true } a secas; se respeta.
  return { ok: true };
}

// ----- Registro -----------------------------------------------------------
// Bloques pendientes:
//   E  upload · move · deleteFile      (bloqueado: cuota de Drive de la SA)
//   F  notifyFotoPending               (bloqueado: MailApp no existe en el SDK)
//   G  setup   (init ya está migrada; setup espera Drive)
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
export const SDK_POST = {
  append,
  update,
  updateCells,
  setConfig,
  setConfigSucursales,
  setEmissions,
  setMedidores,
  setLecturasMedidor,
  setPreciosMedidor,
  upsertSucursal,
  deleteSucursal,
  init,
};

export function sdkImplementa(action) {
  return Object.hasOwn(SDK_GET, action) || Object.hasOwn(SDK_POST, action);
}

/** Nombres implementados, para el diagnóstico de /api/health. */
export function sdkActionsImplementadas() {
  return [...Object.keys(SDK_GET), ...Object.keys(SDK_POST)].sort();
}
