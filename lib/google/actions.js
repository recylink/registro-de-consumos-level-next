import "server-only";
import { HOJAS_REGISTROS, SHEETS } from "../instance";
import {
  ENCABEZADOS,
  ENCABEZADOS_CONFIG,
  ENCABEZADOS_CONFIG_SUCURSALES,
  ENCABEZADOS_EMISIONES,
} from "./headers";
import { mandarAPapelera, moverArchivo } from "./drive-api";
import {
  agregarFilas,
  borrarFilas,
  crearHoja,
  escribirCeldas,
  escribirFilas,
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
        // Se devuelve null, como el original, porque los consumidores tratan null
        // como "sin configurar". Pero se avisa: sin esto, un JSON corrupto en la
        // clave `driveFolders` se presenta al usuario como "carpeta no configurada",
        // que manda a configurar algo que ya está configurado y roto.
        console.warn(
          `[rc:config] la clave "${key}" tiene un JSON ilegible en la hoja ` +
            `"${SHEETS.CONFIG}". Se trata como sin configurar.`,
        );
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

// setConfigSucursales (apps-script.gs:360) ESTUVO acá y se quitó.
//
// Era el último clear+rewrite con un llamador en la app: `writeSucursales`, que solo
// usaba el onboarding. El argumento para dejarlo pasar era que el onboarding define el
// conjunto inicial una sola vez — cierto del primer onboarding, falso del código, que
// se puede re-correr sobre una instancia con datos y borraba toda sucursal ausente de
// la lista. Ahora `writeSucursales` hace un upsert por sucursal (lib/sheets/sucursales.js).
//
// Se quita en vez de dejarla implementada y sin usar, por lo mismo que las tres de
// Medidores: mientras exista, un `RC_SDK_ACTIONS` con el nombre viejo la revive, y el
// `.gs` todavía la atiende.

/** setEmissions (apps-script.gs:420). Rellena las filas cortas y rechaza las largas. */
async function setEmissions({ rows }) {
  const filas = normalizarAncho(rows || [], ENCABEZADOS_EMISIONES.length, "setEmissions");
  await reemplazarHoja(SHEETS.EMISIONES, ENCABEZADOS_EMISIONES, filas);
  return { ok: true };
}

// ----- Escritura por clave (Medidores) ------------------------------------
//
// Estas tres actions REEMPLAZAN a setMedidores / setLecturasMedidor /
// setPreciosMedidor (setSheetRows, apps-script.gs:514), que hacían clear+rewrite
// de la hoja completa. No tienen equivalente en el .gs: son nuevas, y a propósito.
//
// El clobber era el modo de falla real del módulo: la pantalla mandaba el módulo
// entero y la hoja quedaba igual a la copia del último que guardó. El LockService
// del Apps Script serializaba las escrituras pero no detectaba lecturas obsoletas,
// así que "leí hace 40 minutos y ahora escribo encima" pasaba igual. El SDK no
// tiene ni el lock, así que replicar el clear+rewrite era quedarse con lo peor de
// los dos mundos.
//
// Acá se escribe fila por fila, identificada por su clave natural. Ver
// lib/domain/medidores-patch.js para por qué el patch se calcula en el cliente y
// no diffeando contra la planilla.

// Columnas (1-based) que forman la clave de cada hoja. Salen de ENCABEZADOS.
const CLAVE_DE = {
  [SHEETS.MED_MEDIDORES]: [1], // ID
  [SHEETS.MED_LECTURAS]: [2, 3], // Medidor ID + Período
  [SHEETS.MED_PRECIOS]: [1, 2, 3], // Sucursal + Tipo + Período
};

// Columnas cuyo valor de la planilla gana sobre el que llega, si ya tiene algo.
//
// La columna ID de "Lecturas Medidor" es surrogate: la clave de verdad es
// (Medidor ID, Período). `setReading` acuña un id nuevo en cada tecla, así que
// escribirlo haría que el id de una fila cambie cada vez que se corrige su lectura.
// Se conserva el que ya está y solo se usa el nuevo al crear la fila.
const PRESERVADAS_DE = {
  [SHEETS.MED_LECTURAS]: [1], // ID
};

// Igual que en medidores-patch.js: un separador que no puede aparecer dentro de
// un valor escrito a mano.
const SEP_CLAVE = "\u0000";

/** Clave de una fila, según las columnas 1-based indicadas. */
function claveDeFila(fila, cols) {
  return cols.map((c) => String((fila || [])[c - 1] ?? "").trim()).join(SEP_CLAVE);
}

/** Una fila con todas sus columnas clave vacías no es un registro. */
function sinClave(fila, cols) {
  return cols.every((c) => String((fila || [])[c - 1] ?? "").trim() === "");
}

/**
 * Valores de clave (en el orden de `cols`) → fila dispersa con esos valores en su
 * columna. Sirve para pasar por `claveDeFila` algo que no es una fila completa.
 */
function filaDeClave(valores, cols) {
  return cols.reduce((acc, c, j) => {
    acc[c - 1] = (valores || [])[j];
    return acc;
  }, []);
}

/** Índices (0-based, encabezado incluido) de las filas que tienen esa clave. */
function indicesConClave(filas, cols, clave) {
  const out = [];
  for (let i = 1; i < filas.length; i++) {
    if (sinClave(filas[i], cols)) continue;
    if (claveDeFila(filas[i], cols) === clave) out.push(i);
  }
  return out;
}

/**
 * Escribe filas identificadas por clave: actualiza las que ya están, agrega las que
 * no, y borra las que se pidan. Nunca toca una fila que no esté en el patch.
 *
 * `upsert` son filas completas en el orden del encabezado. `remove` son los valores
 * de las columnas clave, en el orden de `CLAVE_DE` — no filas completas, porque para
 * borrar no hace falta el resto.
 *
 * ORDEN: actualizar → agregar → borrar. Es la misma disciplina de `upsertSucursal`:
 * sin transacciones, si el proceso muere a mitad de camino el peor caso tiene que
 * ser una fila vieja de más (visible, y se corrige volviendo a guardar) y nunca una
 * fila que desapareció. Borrar primero podía dejar el dato en la nada.
 *
 * Los índices a borrar salen de la lectura inicial, ANTES de agregar. Agregar al
 * final no corre el índice de ninguna fila previa, así que siguen siendo válidos;
 * `borrarFilas` además ordena de mayor a menor por su cuenta.
 *
 * Si una clave aparece repetida en la hoja (edición humana, o un bug pasado), se
 * actualizan TODAS sus filas en vez de elegir una: así el guardado converge y las
 * copias no quedan con valores distintos. No se borran las repetidas — eso sería
 * destruir datos que nadie pidió destruir, y quedan visibles en la planilla.
 */
async function upsertPorClave({ hoja, encabezados, cols, upsert, remove, preservadas }) {
  const preservar = preservadas || [];
  if (!(await existeHoja(hoja))) await crearHoja(hoja, encabezados);

  const nuevas = encabezados
    ? normalizarAncho(upsert || [], encabezados.length, hoja)
    : upsert || [];

  const filas = await leerHoja(hoja, { crudo: true });
  // clave → índices del arreglo `filas` (0-based, encabezado incluido).
  const indicePorClave = new Map();
  for (let i = 1; i < filas.length; i++) {
    if (sinClave(filas[i], cols)) continue;
    const k = claveDeFila(filas[i], cols);
    if (!indicePorClave.has(k)) indicePorClave.set(k, []);
    indicePorClave.get(k).push(i);
  }

  const aEscribir = [];
  const aAgregar = [];
  const clavesEscritas = new Set();
  for (const fila of nuevas) {
    const k = claveDeFila(fila, cols);
    clavesEscritas.add(k);
    const existentes = indicePorClave.get(k);
    if (!existentes) {
      aAgregar.push(fila);
      continue;
    }
    for (const i of existentes) {
      const values = fila.slice();
      for (const c of preservar) {
        const previo = (filas[i] || [])[c - 1];
        if (previo !== "" && previo != null) values[c - 1] = previo;
      }
      aEscribir.push({ row: i + 1, values });
    }
  }

  const aBorrar = [];
  for (const clave of remove || []) {
    // `remove` trae solo los valores de las columnas clave, en su orden.
    const k = claveDeFila(filaDeClave(clave, cols), cols);
    // Una clave que también se está escribiendo no se borra: sería una
    // contradicción del patch, y borrar sería la mitad destructiva.
    if (clavesEscritas.has(k)) continue;
    for (const i of indicePorClave.get(k) || []) aBorrar.push(i);
  }

  const escritas = await escribirFilas(hoja, aEscribir);
  const agregadas = await agregarFilas(hoja, aAgregar);
  const borradas = await borrarFilas(hoja, aBorrar);
  return { ok: true, escritas, agregadas, borradas };
}

function upsertDe(hoja) {
  return async ({ rows, remove }) =>
    upsertPorClave({
      hoja,
      encabezados: ENCABEZADOS[hoja],
      cols: CLAVE_DE[hoja],
      upsert: rows,
      remove,
      preservadas: PRESERVADAS_DE[hoja],
    });
}

const upsertMedidores = upsertDe(SHEETS.MED_MEDIDORES);
const upsertLecturasMedidor = upsertDe(SHEETS.MED_LECTURAS);
const upsertPreciosMedidor = upsertDe(SHEETS.MED_PRECIOS);

/**
 * Actualiza celdas de la fila que tiene esa clave, sin saber en qué fila está.
 *
 * Es el `UPDATE ... WHERE` que la API de valores no tiene: se lee la hoja, se busca
 * la clave, y se escriben solo las columnas pedidas de esa fila. La alternativa que
 * usaba la app era calcular el número de fila desde la posición del registro en la
 * última lectura (`comb-12` → fila 14), que queda inválido en cuanto alguien
 * reordena o borra una fila — y escribir en la fila equivocada no da ningún error.
 *
 * Si la clave aparece repetida se actualizan todas sus filas, por lo mismo que en
 * `upsertPorClave`: converge en vez de elegir una al azar.
 *
 * `celdas`: [{ col, value }] con col 1-based. `cols` y `clave` son las columnas de
 * la clave y sus valores, en el mismo orden.
 */
async function updateCeldasPorClave({ sheet, cols, clave, celdas }) {
  if (!sheet) throw new Error("sheet name missing");
  if (!cols || !cols.length) throw new Error("key columns missing");
  if (!(await existeHoja(sheet))) throw new Error("sheet not found: " + sheet);

  const filas = await leerHoja(sheet, { crudo: true });
  const k = claveDeFila(filaDeClave(clave, cols), cols);
  const indices = indicesConClave(filas, cols, k);
  if (!indices.length) return { ok: true, filas: 0, celdas: 0 };

  const cel = [];
  for (const i of indices) {
    for (const c of celdas || []) {
      if (c && c.col) cel.push({ row: i + 1, col: c.col, value: c.value });
    }
  }
  await escribirCeldas(sheet, cel);
  return { ok: true, filas: indices.length, celdas: cel.length };
}

// ----- Escritura por clave (Emisiones) ------------------------------------
//
// `upsertEmisiones` reemplaza a `setEmissions` (apps-script.gs:420) como camino de
// la app. Mismo motivo que en Medidores: `setEmissions` reescribía la hoja
// completa, así que dos personas editando factores o metas se borraban el trabajo.
//
// A diferencia de las tres de Medidores, `setEmissions` SIGUE implementada más
// arriba. No es un descuido: /api/migracion/probe-c la usa para comparar los dos
// backends sobre una hoja "Emisiones" que crea y borra, y sacarla rompería esa
// verificación. Ya no la llama nada de la app.

const CLAVE_EMISIONES = [1, 2, 3]; // scope + Sucursal ID + Key
const CLAVE_GRUPO_EMISIONES = [1, 2]; // scope + Sucursal ID

/**
 * Reemplaza todas las filas que comparten un prefijo de clave por las que llegan.
 * Es `upsertSucursal` generalizado: sirve cuando la identidad de la fila individual
 * no es confiable pero la del grupo sí.
 *
 * `grupos`: [{ clave: [...valores de cols], rows: [...filas completas] }].
 * Un grupo con `rows: []` borra el grupo.
 *
 * Misma disciplina que el resto del archivo: los índices a borrar se calculan antes
 * de agregar, se agrega primero y se borra después. Si el proceso muere en el medio
 * quedan filas duplicadas —visibles, y se corrigen volviendo a guardar— en vez de un
 * grupo desaparecido.
 */
async function reemplazarGrupos({ hoja, encabezados, cols, grupos }) {
  if (!(await existeHoja(hoja))) await crearHoja(hoja, encabezados);
  const filas = await leerHoja(hoja, { crudo: true });

  const aAgregar = [];
  const aBorrar = [];
  for (const g of grupos || []) {
    const clave = claveDeFila(filaDeClave(g.clave, cols), cols);
    aBorrar.push(...indicesConClave(filas, cols, clave));
    aAgregar.push(
      ...(encabezados
        ? normalizarAncho(g.rows || [], encabezados.length, hoja)
        : g.rows || []),
    );
  }

  const agregadas = await agregarFilas(hoja, aAgregar);
  const borradas = await borrarFilas(hoja, aBorrar);
  return { agregadas, borradas };
}

/**
 * Filas por clave (factores y metas) + grupos completos (refrigerantes por
 * sucursal), sobre la misma hoja.
 *
 * Los dos mecanismos no se cruzan porque operan sobre scopes distintos: el diff
 * manda los refrigerantes SOLO como grupos y todo lo demás SOLO como filas (ver
 * lib/domain/emisiones-patch.js). Si eso cambiara, el reemplazo de grupo podría
 * borrar una fila que el upsert acaba de escribir.
 */
async function upsertEmisiones({ rows, remove, grupos }) {
  const hoja = SHEETS.EMISIONES;
  const out = { ok: true };

  if ((rows || []).length || (remove || []).length) {
    out.filas = await upsertPorClave({
      hoja,
      encabezados: ENCABEZADOS_EMISIONES,
      cols: CLAVE_EMISIONES,
      upsert: rows,
      remove,
    });
  }
  if ((grupos || []).length) {
    out.grupos = await reemplazarGrupos({
      hoja,
      encabezados: ENCABEZADOS_EMISIONES,
      cols: CLAVE_GRUPO_EMISIONES,
      grupos,
    });
  }
  return out;
}

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

// ----- Drive (bloque E) ---------------------------------------------------
//
// El bloque estuvo bloqueado semanas por la cuota de la service account. Dejó de
// estarlo el 2026-08-06, cuando las carpetas de la app pasaron a una Unidad
// compartida: adentro los archivos son de la unidad, no de quien los crea. Ver
// lib/google/drive-api.js.

/**
 * moveFile (apps-script.gs:279). Mueve un archivo de una carpeta a otra.
 *
 * El original usaba `addFile` + `removeFile`, dos operaciones sueltas; acá es un
 * request con addParents/removeParents. Misma respuesta `{ ok: true }`: el .gs no
 * devolvía nada del archivo y `moveInDrive` (lib/drive.js) ignora el resultado.
 *
 * `fromFolderId` y `toFolderId` siguen siendo opcionales por separado, como en el
 * original. `fileId` no: sin él el .gs reventaba en `getFileById` con un mensaje de
 * Drive, y un mensaje propio dice antes qué falta.
 */
async function move({ fileId, fromFolderId, toFolderId }) {
  if (!fileId) throw new Error("fileId missing");
  await moverArchivo({ fileId, de: fromFolderId, a: toFolderId });
  return { ok: true };
}

/**
 * deleteFile (apps-script.gs:287). Manda el archivo a la papelera.
 *
 * El nombre miente y se conserva igual, porque lo usan la app y el .gs: no elimina
 * nada, marca `trashed`. Esa es la semántica que espera la UI —borrar un adjunto en
 * Medidores no tiene deshacer del lado de la app, pero el archivo sigue treinta días
 * en la papelera— y la única que la service account puede ejecutar: eliminar de
 * verdad pide ser Administrador de la Unidad compartida, y no lo es.
 *
 * Mismo mensaje de error que el original para el caso sin id (apps-script.gs:288).
 */
async function deleteFile({ fileId }) {
  if (!fileId) throw new Error("fileId missing");
  await mandarAPapelera(fileId);
  return { ok: true };
}

// ----- Registro -----------------------------------------------------------
// Bloques pendientes:
//   E  upload                          (`move` y `deleteFile` ya están migradas)
//   F  notifyFotoPending               (bloqueado: MailApp no existe en el SDK)
//   G  setup   (init ya está migrada; setup crea el árbol de carpetas)
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
  setEmissions,
  // setMedidores / setLecturasMedidor / setPreciosMedidor NO están acá a
  // propósito. Eran clear+rewrite de la hoja completa y son la causa conocida de
  // pérdida de datos del módulo; las reemplazan las tres `upsert*` de abajo.
  //
  // El .gs todavía las tiene (setSheetRows), así que dejarlas implementadas acá
  // habría dejado abierta la puerta de vuelta al clobber: basta un
  // RC_SDK_ACTIONS con el nombre viejo. Al no estar, `estadoFlag()` las reporta
  // como desconocidas en /api/health en vez de aceptarlas en silencio.
  upsertMedidores,
  upsertLecturasMedidor,
  upsertPreciosMedidor,
  upsertEmisiones,
  updateCeldasPorClave,
  upsertSucursal,
  deleteSucursal,
  init,
  move,
  deleteFile,
};

export function sdkImplementa(action) {
  return Object.hasOwn(SDK_GET, action) || Object.hasOwn(SDK_POST, action);
}

/** Nombres implementados, para el diagnóstico de /api/health. */
export function sdkActionsImplementadas() {
  return [...Object.keys(SDK_GET), ...Object.keys(SDK_POST)].sort();
}
