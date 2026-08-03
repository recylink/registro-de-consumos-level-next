import "server-only";
import { sheetsApi } from "./auth";
import { spreadsheetId } from "../instance";

// Helpers de bajo nivel sobre la API de Sheets v4, con la semántica EXACTA de
// sus equivalentes de Apps Script. Las diferencias son sutiles y silenciosas, así
// que van documentadas donde importan.

/**
 * Títulos y sheetId de las hojas. Hace falta para lo que la API de valores no
 * sabe hacer: borrar una hoja o filas necesita el `sheetId` numérico, no el
 * nombre.
 *
 * Las lecturas NO la usan: `leerHoja` pide los valores directo y trata el 400
 * "Unable to parse range" como "hoja inexistente". Consultarla antes de cada
 * lectura duplicaba los requests contra una cuota de 60 por minuto.
 *
 * Se memoiza unos segundos; las escrituras que crean o borran hojas invalidan el
 * caché a mano (ver invalidarHojas).
 */
let cacheHojas = null;
let cacheHojasVence = 0;
const TTL_HOJAS_MS = 5000;

export function invalidarHojas() {
  cacheHojas = null;
  cacheHojasVence = 0;
}

export async function hojas({ ahora = 0 } = {}) {
  const t = ahora || Date.now();
  if (cacheHojas && t < cacheHojasVence) return cacheHojas;
  contador.metadata++;
  const res = await sheetsApi().spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties(title,sheetId,gridProperties/rowCount)",
  });
  cacheHojas = (res.data.sheets || []).map((s) => ({
    titulo: s.properties.title,
    sheetId: s.properties.sheetId,
    // Tamaño de la grilla, no del rango de datos. Lo necesita el recorte de
    // `reemplazarHoja`: para limpiar "de la fila N hasta el final" hay que decir
    // dónde termina la hoja, y un rango más allá de la grilla es un 400.
    filas: s.properties.gridProperties?.rowCount ?? 1000,
  }));
  cacheHojasVence = t + TTL_HOJAS_MS;
  return cacheHojas;
}

export async function existeHoja(nombre) {
  return (await hojas()).some((h) => h.titulo === nombre);
}

/**
 * ¿Este error es "la hoja no existe"? La API contesta 400 con "Unable to parse
 * range" cuando el nombre no corresponde a ninguna hoja. Detectarlo permite pedir
 * los valores de una sola vez en vez de consultar antes la metadata: eran dos
 * requests por lectura, y la cuota de Sheets es de 60 lecturas por minuto y por
 * usuario — la mitad de la que hace falta se iba en preguntar si la hoja existe.
 */
function esRangoInexistente(err) {
  const msg = String(err?.message || "");
  return (err?.code === 400 || err?.status === 400) && /Unable to parse range/i.test(msg);
}

function esCuotaExcedida(err) {
  const msg = String(err?.message || "");
  return err?.code === 429 || err?.status === 429 || /Quota exceeded/i.test(msg);
}

// Cuántas llamadas reales salieron a la API de Sheets, por tipo. Existe porque
// la cuota (60 lecturas por minuto y por usuario) se pasa por acumulación, y por
// el resultado no se puede saber si la caché está trabajando: una lectura
// cacheada y una real devuelven lo mismo.
//
// OJO con dónde se lee: solo sirve DENTRO del mismo request que hizo las
// llamadas. En dev cada route handler recibe su propia instancia de este módulo,
// así que un endpoint no puede medir lo que gastó otro — /api/health leía siempre
// cero por eso. Cada endpoint que quiera reportar consumo tiene que reiniciar y
// leer el contador él mismo.
const contador = { valuesGet: 0, batchGet: 0, metadata: 0, escrituras: 0, reintentos429: 0 };

export function contadorLlamadas() {
  return { ...contador };
}

export function reiniciarContador() {
  for (const k of Object.keys(contador)) contador[k] = 0;
}

/**
 * Reintenta ante 429. La cuota de Sheets es por minuto, así que las esperas son
 * largas a propósito: un render de varias páginas puede pasarse por ráfaga y
 * reintentar rápido solo gasta más cuota.
 */
async function conEspera(fn, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!esCuotaExcedida(err) || i === intentos - 1) throw err;
      contador.reintentos429++;
      ultimo = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw ultimo;
}

export async function sheetIdDe(nombre) {
  const h = (await hojas()).find((x) => x.titulo === nombre);
  return h ? h.sheetId : null;
}

/**
 * Rellena las filas hasta el ancho de la más larga.
 *
 * `getDataRange().getValues()` de Apps Script devuelve una matriz rectangular:
 * toda fila llega con tantas celdas como columnas tenga el rango de datos. La
 * API de valores recorta las celdas vacías del final de cada fila, así que las
 * filas quedan de largos distintos.
 *
 * Sin este relleno, `records.js` (que lee con `row[col - 1]`, hasta la columna 12
 * en Agua) recibe `undefined` donde antes recibía `""`, y eso viaja hacia
 * `estadoValue` / `origenValue` sin que nada avise.
 */
export function rectangular(filas) {
  const ancho = filas.reduce((m, f) => Math.max(m, f.length), 0);
  return filas.map((f) => {
    const out = f.slice(0, ancho);
    while (out.length < ancho) out.push("");
    return out;
  });
}

/**
 * Todas las filas de una hoja, con encabezado, ya rectangulares.
 * Hoja inexistente → `[]`, como hacía Apps Script.
 *
 * `crudo` elige entre los dos modos de lectura que el script mezclaba, y hay que
 * respetarlo hoja por hoja:
 *   - `false` → FORMATTED_VALUE, equivale a `getDisplayValues()`. Devuelve lo que
 *     se ve en la celda: "20.440", "31-07-26". Es lo que esperan los parsers de
 *     lib/domain/parse.js.
 *   - `true` → UNFORMATTED_VALUE, equivale a `getValues()`. Devuelve el valor
 *     tipado: 20440, un serial de fecha.
 * Unificarlos rompe los parsers sin lanzar ningún error.
 */
export async function leerHoja(nombre, { crudo = false } = {}) {
  try {
    contador.valuesGet++;
    const res = await conEspera(() =>
      sheetsApi().spreadsheets.values.get({
        spreadsheetId: spreadsheetId(),
        // El nombre a secas como rango = el rango de datos completo, igual que
        // getDataRange(). Va entre comillas simples por los nombres con espacios
        // ("Lecturas Medidor") y se escapan las comillas internas.
        range: `'${nombre.replace(/'/g, "''")}'`,
        valueRenderOption: crudo ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      }),
    );
    return rectangular(res.data.values || []);
  } catch (err) {
    // Hoja inexistente → [], como devolvía Apps Script cuando getSheetByName
    // daba null. Se pide y se maneja el fallo en vez de preguntar antes por la
    // metadata, que duplicaba los requests contra una cuota de 60 por minuto.
    if (esRangoInexistente(err)) return [];
    throw err;
  }
}

/** Filas de datos, sin el encabezado. Equivale a `data.slice(1)` del script. */
export async function leerFilas(nombre, opts) {
  const todo = await leerHoja(nombre, opts);
  return todo.slice(1);
}

// ----- Escritura ----------------------------------------------------------

/**
 * Cómo interpreta Google lo que se escribe. Es la decisión más delicada de la
 * migración de escrituras:
 *
 *   RAW           guarda el string tal cual. "31-07-26" queda como texto.
 *   USER_ENTERED  lo interpreta como si alguien lo tipeara: "31-07-26" puede
 *                 volverse una fecha, "20.440" un número, "=1+1" una fórmula.
 *
 * `Range.setValues()` de Apps Script no documenta con claridad cuál de los dos
 * imita, y elegir mal cambia en silencio lo que leen después `parseDate` y
 * `toNumber`. El valor de acá salió de medirlo contra la planilla real con
 * /api/migracion/probe-escritura, no de suponerlo.
 */
export const MODO_ESCRITURA = "USER_ENTERED";

export async function crearHoja(nombre, encabezados) {
  contador.escrituras++;
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: { requests: [{ addSheet: { properties: { title: nombre } } }] },
  });
  invalidarHojas();
  if (encabezados && encabezados.length) {
    contador.escrituras++;
    await sheetsApi().spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `'${nombre.replace(/'/g, "''")}'!A1`,
      valueInputOption: "RAW", // los encabezados son texto literal, siempre
      requestBody: { values: [encabezados] },
    });
  }
}

export async function borrarHoja(nombre) {
  const id = await sheetIdDe(nombre);
  if (id == null) return false;
  contador.escrituras++;
  await sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: { requests: [{ deleteSheet: { sheetId: id } }] },
  });
  invalidarHojas();
  return true;
}

/**
 * Agrega filas al final. Mejora real sobre el Apps Script: `values.append` con
 * `INSERT_ROWS` resuelve del lado del servidor dónde termina la tabla, así que
 * desaparece la carrera de leer `getLastRow()` y escribir después — que era
 * justamente lo que el `LockService` estaba tapando (apps-script.gs:114).
 */
export async function agregarFilas(nombre, filas, { modo = MODO_ESCRITURA } = {}) {
  if (!filas || !filas.length) return 0;
  contador.escrituras++;
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `'${nombre.replace(/'/g, "''")}'`,
    valueInputOption: modo,
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: filas },
  });
  return filas.length;
}

/**
 * Reemplaza el contenido de una hoja: encabezado + filas, y el resto vacío.
 * Equivale a `setSheetRows` / `setEmissions` / `setConfigSucursales` del Apps
 * Script (apps-script.gs:514, 420, 360), que hacían `sheet.clear()` y reescribían.
 *
 * ORDEN INVERTIDO, y es la decisión de diseño del bloque:
 *
 * El Apps Script limpiaba y después escribía, protegido por `LockService`
 * (apps-script.gs:114). El SDK no tiene lock, así que ese orden deja una ventana
 * en la que la hoja está VACÍA: si el proceso muere entre las dos llamadas —o si
 * la segunda falla— se perdió todo. Acá se escribe primero y se recorta después,
 * de modo que el peor caso es quedarse con filas viejas de más, nunca con una hoja
 * vacía. Falla del lado seguro.
 *
 * No usa `spreadsheets.batchUpdate`, que sería atómico de verdad, porque su
 * request `updateCells` obliga a tipar cada valor a mano y pierde la
 * interpretación de USER_ENTERED — que es la que imita a `setValues()` (medido en
 * /api/migracion/probe-escritura). Entre atomicidad y escribir los mismos valores
 * que antes, gana lo segundo: un desajuste de tipos corrompe datos en silencio.
 *
 * Lo que esto NO resuelve: dos clientes reescribiendo la misma hoja a la vez
 * siguen pisándose, porque cada uno manda su versión completa. Para eso hace
 * falta escribir por filas, como `upsertSucursal`.
 *
 * Otra diferencia con `clear()`: aquel borraba también el formato de las celdas.
 * Acá solo se borra el contenido, así que el formato que alguien le haya puesto a
 * la planilla a mano sobrevive.
 */
export async function reemplazarHoja(nombre, encabezados, filas) {
  const datos = filas || [];
  if (!(await existeHoja(nombre))) await crearHoja(nombre);

  const hoja = `'${nombre.replace(/'/g, "''")}'`;
  const contenido = encabezados && encabezados.length ? [encabezados, ...datos] : datos;

  if (contenido.length) {
    contador.escrituras++;
    await conEspera(() =>
      sheetsApi().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${hoja}!A1`,
        valueInputOption: MODO_ESCRITURA,
        requestBody: { values: contenido },
      }),
    );
  }

  // Recorte: todo lo que quedó abajo de lo escrito. Se pide el alto de la grilla
  // (metadata cacheada) porque un rango más allá del final de la hoja es un 400.
  const meta = (await hojas()).find((h) => h.titulo === nombre);
  const alto = meta?.filas ?? 0;
  const primeraSobrante = contenido.length + 1;
  if (alto >= primeraSobrante) {
    contador.escrituras++;
    await conEspera(() =>
      sheetsApi().spreadsheets.values.clear({
        spreadsheetId: spreadsheetId(),
        // `A!3:1000` en notación A1 son las filas completas, todas sus columnas.
        range: `${hoja}!${primeraSobrante}:${alto}`,
      }),
    );
  }
  return datos.length;
}

/**
 * Ajusta cada fila al ancho del encabezado. Lo hacía `setSheetRows`
 * (apps-script.gs:524); `setEmissions` y `setConfigSucursales` no, y una fila de
 * largo distinto les hacía fallar el guardado entero con un mensaje de Google
 * ("El número de columnas de los datos no coincide...") que no dice qué fila.
 *
 * Acá se normaliza en las tres, pero con una asimetría deliberada:
 *
 *   - Una fila CORTA se rellena. Las filas las arma `flatten()` en lib/sheets/,
 *     no un humano, así que un largo raro es un bug de código — y perder el
 *     guardado completo del usuario por eso es peor que escribir la fila.
 *   - Una fila LARGA se rechaza. Truncarla escribiría datos incompletos sin que
 *     nada avise, que es el único resultado peor que fallar.
 *
 * En los dos casos se deja rastro en el log: si `flatten()` empieza a producir
 * filas mal formadas, hay que poder verlo.
 */
export function normalizarAncho(filas, ancho, contexto = "") {
  const largas = [];
  const cortas = [];
  const out = (filas || []).map((f, i) => {
    if (f.length > ancho) largas.push({ fila: i + 1, largo: f.length });
    if (f.length < ancho) cortas.push({ fila: i + 1, largo: f.length });
    const fila = f.slice();
    while (fila.length < ancho) fila.push("");
    return fila;
  });
  if (largas.length) {
    throw new Error(
      `Filas más anchas que el encabezado (${ancho} columnas)${contexto ? " en " + contexto : ""}: ` +
        largas.map((l) => `fila ${l.fila} tiene ${l.largo}`).join(", "),
    );
  }
  if (cortas.length) {
    console.warn(
      `[rc:sheets] se rellenaron ${cortas.length} fila(s) corta(s)` +
        (contexto ? ` en ${contexto}` : "") +
        ` hasta ${ancho} columnas:`,
      cortas,
    );
  }
  return out;
}

/** Índice de columna 1-based → letra de columna ("A", "AA"). */
export function letraColumna(col) {
  let n = col;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Celdas sueltas de una misma hoja, en un solo request.
 * `cells`: [{ row, col, value }] con row/col 1-based, igual que el Apps Script.
 */
export async function escribirCeldas(nombre, celdas, { modo = MODO_ESCRITURA } = {}) {
  const validas = (celdas || []).filter((c) => c && c.row && c.col);
  if (!validas.length) return 0;
  const hoja = `'${nombre.replace(/'/g, "''")}'`;
  contador.escrituras++;
  await sheetsApi().spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      valueInputOption: modo,
      data: validas.map((c) => ({
        range: `${hoja}!${letraColumna(c.col)}${c.row}`,
        values: [[c.value]],
      })),
    },
  });
  return validas.length;
}

/**
 * Varias hojas en un solo request. `readAll` leía tres hojas con tres llamadas;
 * batchGet las trae juntas. Las que no existen salen como `[]`.
 *
 * Se piden todas de entrada aunque batchGet falle entero si una sola no existe:
 * el caso normal es que existan, y así se gasta un request en vez de dos. Solo
 * cuando falla se consulta la metadata para filtrar y reintentar.
 */
export async function leerVariasHojas(nombres, { crudo = false } = {}) {
  const out = {};
  for (const n of nombres) out[n] = [];
  if (!nombres.length) return out;

  const rango = (n) => `'${n.replace(/'/g, "''")}'`;
  const pedir = async (lista) => {
    contador.batchGet++;
    return conEspera(() =>
      sheetsApi().spreadsheets.values.batchGet({
        spreadsheetId: spreadsheetId(),
        ranges: lista.map(rango),
        valueRenderOption: crudo ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      }),
    );
  };

  // Optimista: se piden todas de una. batchGet falla entero si UNA hoja no
  // existe, y solo entonces vale gastar el request de metadata para filtrar.
  let lista = nombres;
  let res;
  try {
    res = await pedir(lista);
  } catch (err) {
    if (!esRangoInexistente(err)) throw err;
    const presentes = new Set((await hojas()).map((h) => h.titulo));
    lista = nombres.filter((n) => presentes.has(n));
    if (!lista.length) return out;
    res = await pedir(lista);
  }

  // batchGet devuelve los rangos en el orden pedido.
  (res.data.valueRanges || []).forEach((vr, i) => {
    out[lista[i]] = rectangular(vr.values || []);
  });
  return out;
}
