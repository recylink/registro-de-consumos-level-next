/**
 * Registro de Consumos — Apps Script backend
 *
 * Este script vive dentro del Google Spreadsheet y expone un endpoint HTTP
 * público que la app web usa para leer/escribir registros y subir archivos
 * a Drive. Permite que cualquier usuario use la app SIN iniciar sesión con
 * su cuenta Google: las operaciones se ejecutan con TU cuenta (la que
 * desplegó el script).
 *
 * --- CÓMO DESPLEGAR ---
 *
 * 1. Abre la planilla de destino de ESTA instancia (una planilla nueva y vacía;
 *    las pestañas las crea el script). Ojo: este archivo ya no trae el ID de
 *    ninguna planilla — opera sobre la que lo contiene.
 *
 * 2. Menú: Extensiones > Apps Script
 *
 * 3. Borra el contenido del archivo `Código.gs` y pega ESTE archivo completo.
 *
 * 4. Guarda (Ctrl+S). Pon un nombre al proyecto (ej: "Registro de Consumos API").
 *
 * 5. Botón "Implementar" (arriba a la derecha) > "Nueva implementación".
 *    - Tipo: "Aplicación web"
 *    - Descripción: lo que quieras
 *    - Ejecutar como: "Yo" (tu cuenta)
 *    - Quién tiene acceso: "Cualquier usuario"
 *    - Click "Implementar"
 *
 * 6. La primera vez te pedirá autorizar. Acepta los permisos
 *    (Sheets + Drive). Si aparece "Esta app no está verificada" haz click en
 *    "Avanzado" > "Ir a [nombre] (no seguro)" y continúa. Es seguro: es tu
 *    propio script con tu propia cuenta.
 *
 * 7. Copia la URL que aparece bajo "URL de la app web". Termina en /exec.
 *
 * 8. Pon esa URL en `APPS_SCRIPT_URL` de `.env.local` (y en las variables de
 *    entorno de Vercel). Nunca va en el código: en la app Next el endpoint se
 *    lee solo desde el servidor.
 *
 * 9. Provisión: crea UNA carpeta raíz en Drive y corre la acción `setup` con su
 *    ID. Crea las hojas y todo el árbol de subcarpetas, y guarda los IDs en la
 *    hoja "Config". Es idempotente.
 *
 *      curl -L -X POST "<URL>/exec" -H "Content-Type: text/plain" \
 *        -d '{"action":"setup","rootFolderId":"<ID de la carpeta raíz>"}'
 *
 * --- ACTUALIZACIONES ---
 *
 * Si modificas este script: Implementar > "Administrar implementaciones"
 * > edita la existente (ícono de lápiz) > Versión "Nueva versión" >
 * Implementar. La URL no cambia.
 */

// Versión del script desplegado. Subir en cada cambio; se devuelve en `ping`
// para verificar por curl qué versión corre en el /exec (evita pegar un
// archivo viejo). Snapshot congelado en appscripts/vN_fecha.gs.
const SCRIPT_VERSION = "v4";

// WEB_CFG en vez de CONFIG porque el procesador de Combustible (archivo Código.gs
// en el proyecto Apps Script) ya declara `var CONFIG`. Si usáramos el mismo nombre
// Apps Script lanza "Identifier 'CONFIG' has already been declared". Convivimos.
const WEB_CFG = {
  // 👉 ID de la planilla de destino.
  // Vacío = usar la planilla que contiene este script (lo normal: el script se
  // pega desde Extensiones > Apps Script de la planilla de destino). Solo se
  // completa para apuntar a OTRA planilla. Dejarlo vacío evita el accidente de
  // heredar el ID de otra instancia al copiar este archivo.
  SPREADSHEET_ID: "",
  // Los IDs de carpetas de Drive NO viven acá: los crea la acción `setup` y
  // quedan en la clave `driveFolders` de la hoja "Config".
  HEADERS: {
    Combustible:    ["Link", "Fecha", "Consumo", "Costo", "Empresa", "Sucursal", "Tipo", "Proveedor", "Estado", "Origen"],
    Electricidad:   ["Link PDF", "Número de cliente", "Fecha", "Consumo total", "Costo ($)", "Empresa", "Sucursal", "Tipo de consumo", "Proveedor", "Estado", "Origen"],
    Agua:           ["Link PDF", "Número de cliente", "Fecha emisión", "Consumo total", "Costo ($)", "Empresa", "Sucursal", "Tipo de consumo", "Proveedor", "Subcategoría", "Estado", "Origen"],
    "N° de cliente":["Número de cliente", "Empresa", "Sucursal", "Tipo de consumo", "Proveedor"],
    "Fill out":     ["Submission ID", "Submission time", "Nombre Usuario", "Nombre sucursal", "Mes de registro", "N° trabajadores", "N° trabajadoras", "m2 totales", "% Avance", "URL Excel Petróleo", "URL Excel Gas", "Procesado"],
    // Flujo "Tomar foto" — una fila por foto subida; pendiente hasta que se completen datos.
    Fotos:          ["File ID", "Drive URL", "Fecha subida", "Tipo", "Sucursal", "Subcategoría", "Período", "Status", "Fecha completado", "Consumo", "Unidad", "Costo", "Proveedor", "Notas"],
    // Módulo Medidores (lecturas físicas).
    "Medidores":        ["ID", "Sucursal", "Tipo", "Nombre", "Número", "Activo", "Facturable"],
    "Lecturas Medidor": ["ID", "Medidor ID", "Período", "Lectura", "Factura Link", "Factura Nombre", "Factura File ID", "Pago Link", "Pago Nombre", "Pago File ID", "Respaldo Link", "Respaldo Nombre", "Respaldo File ID"],
    "Precios Medidor":  ["Sucursal", "Tipo", "Período", "Precio"],
  },
};

// Planilla sobre la que opera el script. Sin SPREADSHEET_ID usa la contenedora.
function rcSpreadsheet() {
  if (WEB_CFG.SPREADSHEET_ID) return SpreadsheetApp.openById(WEB_CFG.SPREADSHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("Sin planilla: pega este script desde Extensiones > Apps Script de la planilla, o completa WEB_CFG.SPREADSHEET_ID.");
  return active;
}

// ----- HTTP entrypoints --------------------------------------------------

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || "read";
    if (action === "read") return jsonOut(readAll());
    if (action === "getConfig") return jsonOut(getConfigValue(e.parameter.key));
    if (action === "getConfigSucursales") return jsonOut(getConfigSucursales());
    if (action === "getEmissions") return jsonOut(getEmissions());
    if (action === "getFotos") return jsonOut(getFotos());
    if (action === "getMedidores")       return jsonOut(getSheetRows("Medidores"));
    if (action === "getLecturasMedidor") return jsonOut(getSheetRows("Lecturas Medidor"));
    if (action === "getPreciosMedidor")  return jsonOut(getSheetRows("Precios Medidor"));
    if (action === "ping") return jsonOut({ ok: true, pong: new Date().toISOString(), version: SCRIPT_VERSION });
    return jsonOut({ error: "unknown action: " + action });
  } catch (err) {
    return jsonOut({ error: String(err && err.message || err) });
  }
}

// Serializa mutaciones al Spreadsheet. Apps Script corre ejecuciones en
// paralelo: sin lock, dos `append` simultáneos leen el mismo getLastRow() y se
// pisan. waitLock espera hasta 30s a que el otro termine.
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action;
    // --- Mutaciones al Sheet: bajo lock (serializadas) ---
    if (action === "setConfig") {
      withLock(function () { setConfigValue(body.key, body.value); });
      return jsonOut({ ok: true });
    }
    if (action === "setConfigSucursales") {
      withLock(function () { setConfigSucursales(body.rows || []); });
      return jsonOut({ ok: true });
    }
    if (action === "upsertSucursal") {
      withLock(function () { upsertSucursal(body.id, body.rows || []); });
      return jsonOut({ ok: true });
    }
    if (action === "deleteSucursal") {
      withLock(function () { deleteSucursalRows(body.id); });
      return jsonOut({ ok: true });
    }
    if (action === "setEmissions") {
      withLock(function () { setEmissions(body.rows || []); });
      return jsonOut({ ok: true });
    }
    if (action === "append") {
      withLock(function () { appendRows(body.sheet, body.values || []); });
      return jsonOut({ ok: true, appended: (body.values || []).length });
    }
    if (action === "update") {
      withLock(function () { updateCell(body.sheet, body.row, body.col, body.value); });
      return jsonOut({ ok: true });
    }
    // Varias celdas de una misma hoja en un solo request. Completar una foto
    // toca 11 celdas: con `update` eran 11 round-trips al /exec (y 11 locks).
    if (action === "updateCells") {
      withLock(function () { updateCells(body.sheet, body.cells || []); });
      return jsonOut({ ok: true, updated: (body.cells || []).length });
    }
    if (action === "init") {
      withLock(function () { ensureSheets(); });
      return jsonOut({ ok: true });
    }
    // Provisión de la instancia: crea hojas + árbol de carpetas y deja los IDs
    // en la config. Idempotente: reusa lo que ya exista.
    if (action === "setup") {
      return jsonOut(withLock(function () { return setupInstance(body.rootFolderId); }));
    }
    // --- Drive / mail: sin lock (cada archivo es independiente, no hay carrera) ---
    if (action === "upload") {
      return jsonOut(uploadFile(body.name, body.mimeType, body.base64, body.folderId, body.subfolders));
    }
    if (action === "move") {
      moveFile(body.fileId, body.fromFolderId, body.toFolderId);
      return jsonOut({ ok: true });
    }
    if (action === "deleteFile") {
      deleteFile(body.fileId);
      return jsonOut({ ok: true });
    }
    if (action === "notifyFotoPending") {
      return jsonOut(notifyFotoPending(body));
    }
    if (action === "setMedidores") {
      withLock(function () { setSheetRows("Medidores", body.rows || []); });
      return jsonOut({ ok: true });
    }
    if (action === "setLecturasMedidor") {
      withLock(function () { setSheetRows("Lecturas Medidor", body.rows || []); });
      return jsonOut({ ok: true });
    }
    if (action === "setPreciosMedidor") {
      withLock(function () { setSheetRows("Precios Medidor", body.rows || []); });
      return jsonOut({ ok: true });
    }
    return jsonOut({ error: "unknown action: " + action });
  } catch (err) {
    return jsonOut({ error: String(err && err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----- Operations --------------------------------------------------------

function readAll() {
  const ss = rcSpreadsheet();
  const result = {};
  ["Combustible", "Electricidad", "Agua"].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { result[name] = []; return; }
    result[name] = sheet.getDataRange().getDisplayValues();
  });
  return result;
}

function appendRows(sheetName, values) {
  if (!sheetName) throw new Error("sheet name missing");
  if (!values || !values.length) return;
  const ss = rcSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = WEB_CFG.HEADERS[sheetName];
    if (headers) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, values.length, values[0].length).setValues(values);
}

// cells: [{ row, col, value }] — todas de la misma hoja.
function updateCells(sheetName, cells) {
  if (!sheetName) throw new Error("sheet name missing");
  if (!cells || !cells.length) return;
  const sheet = rcSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("sheet not found: " + sheetName);
  cells.forEach(function (c) {
    if (!c || !c.row || !c.col) return;
    sheet.getRange(c.row, c.col).setValue(c.value);
  });
}

function updateCell(sheetName, row, col, value) {
  if (!sheetName) throw new Error("sheet name missing");
  if (!row || !col) throw new Error("row/col missing");
  const ss = rcSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("sheet not found: " + sheetName);
  sheet.getRange(row, col).setValue(value);
}

// `subfolders` (opcional): ruta de subcarpetas bajo folderId, ej ["Medidor 1 (N° 123)", "2026-07"].
// Se navegan por nombre y se crean las que falten (con lock para no duplicar
// carpetas en subidas concurrentes).
function uploadFile(name, mimeType, base64, folderId, subfolders) {
  if (!folderId) throw new Error("folderId missing");
  const bytes = Utilities.base64Decode(base64 || "");
  const blob = Utilities.newBlob(bytes, mimeType || "application/octet-stream", name || "archivo");
  let folder = DriveApp.getFolderById(folderId);
  const path = (subfolders || []).map(function (s) { return String(s || "").trim(); }).filter(String);
  if (path.length) {
    withLock(function () {
      path.forEach(function (nm) {
        const it = folder.getFoldersByName(nm);
        folder = it.hasNext() ? it.next() : folder.createFolder(nm);
      });
    });
  }
  const file = folder.createFile(blob);
  return { id: file.getId(), link: file.getUrl() };
}

function moveFile(fileId, fromFolderId, toFolderId) {
  const file = DriveApp.getFileById(fileId);
  if (toFolderId) DriveApp.getFolderById(toFolderId).addFile(file);
  if (fromFolderId) DriveApp.getFolderById(fromFolderId).removeFile(file);
}

// Envía un archivo a la papelera de Drive (recuperable 30 días por el dueño;
// desde la app la acción no tiene deshacer).
function deleteFile(fileId) {
  if (!fileId) throw new Error("fileId missing");
  DriveApp.getFileById(fileId).setTrashed(true);
}

function ensureSheets() {
  const ss = rcSpreadsheet();
  Object.keys(WEB_CFG.HEADERS).forEach(function (name) {
    if (!ss.getSheetByName(name)) {
      const sh = ss.insertSheet(name);
      const headers = WEB_CFG.HEADERS[name];
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });
}

// ----- Config key/value store (hoja "Config") ----------------------------

function getConfigValue(key) {
  if (!key) return { value: null };
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName("Config");
  if (!sheet) return { value: null };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      try { return { value: JSON.parse(data[i][1]) }; } catch (e) { return { value: null }; }
    }
  }
  return { value: null };
}

function setConfigValue(key, value) {
  if (!key) throw new Error("key missing");
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName("Config");
  if (!sheet) {
    sheet = ss.insertSheet("Config");
    sheet.getRange(1, 1, 1, 2).setValues([["key", "value"]]);
  }
  var data = sheet.getDataRange().getValues();
  var json = JSON.stringify(value);
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(json);
      return;
    }
  }
  sheet.appendRow([key, json]);
}

// ----- Config sucursales (tabla relacional, una fila por subcategoría) ----

var CONFIG_SUC_SHEET = "Config Sucursales";
var CONFIG_SUC_HEADERS = [
  "Sucursal ID", "Nombre", "Dirección", "Activa", "Tipo consumo", "Subcat ID",
  "Sistema eléctrico", "Tipo", "Tipo (otro)", "Uso", "Unidad",
  "Proveedor", "Proveedor (otro)", "N° cliente",
];

function getConfigSucursales() {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_SUC_SHEET);
  if (!sheet) return { rows: [] };
  var data = sheet.getDataRange().getValues();
  return { rows: data.slice(1) }; // sin encabezado
}

function setConfigSucursales(rows) {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_SUC_SHEET);
  if (!sheet) sheet = ss.insertSheet(CONFIG_SUC_SHEET);
  sheet.clear();
  sheet.getRange(1, 1, 1, CONFIG_SUC_HEADERS.length).setValues([CONFIG_SUC_HEADERS]);
  if (rows && rows.length) {
    sheet.getRange(2, 1, rows.length, CONFIG_SUC_HEADERS.length).setValues(rows);
  }
}

function _configSucSheet() {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_SUC_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SUC_SHEET);
    sheet.getRange(1, 1, 1, CONFIG_SUC_HEADERS.length).setValues([CONFIG_SUC_HEADERS]);
  }
  return sheet;
}

// Borra todas las filas cuya columna "Sucursal ID" (col 1) === id.
// De abajo hacia arriba para no desalinear índices al borrar.
function deleteSucursalRows(id) {
  if (!id) throw new Error("sucursal id missing");
  var sheet = _configSucSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) { // salta encabezado (i=0)
    if (String(data[i][0]) === String(id)) sheet.deleteRow(i + 1);
  }
}

// Reemplaza SOLO las filas de una sucursal (por ID), sin tocar las demás.
// Evita el clobber de la reescritura total cuando varios editan a la vez.
function upsertSucursal(id, rows) {
  if (!id) throw new Error("sucursal id missing");
  deleteSucursalRows(id);
  if (rows && rows.length) {
    var sheet = _configSucSheet();
    var start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, rows.length, CONFIG_SUC_HEADERS.length).setValues(rows);
  }
}

// ----- Factores de emisión (hoja "Emisiones") ----------------------------
// Una fila por entrada. Scopes: factor-empresa | factor-sucursal | refrigerante | meta-empresa | meta-sucursal.

var EMISSIONS_SHEET = "Emisiones";
var EMISSIONS_HEADERS = [
  "Scope", "Sucursal ID", "Key", "Value", "Pending Review", "Refrig Tipo", "Refrig Mes",
];

function getEmissions() {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName(EMISSIONS_SHEET);
  if (!sheet) return { rows: [] };
  var data = sheet.getDataRange().getValues();
  return { rows: data.slice(1) };
}

function setEmissions(rows) {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName(EMISSIONS_SHEET);
  if (!sheet) sheet = ss.insertSheet(EMISSIONS_SHEET);
  sheet.clear();
  sheet.getRange(1, 1, 1, EMISSIONS_HEADERS.length).setValues([EMISSIONS_HEADERS]);
  if (rows && rows.length) {
    sheet.getRange(2, 1, rows.length, EMISSIONS_HEADERS.length).setValues(rows);
  }
}

// Helper de autorización: forzar consent del scope MailApp.
// Correr desde el editor (Run ▶) — pide permiso la primera vez y manda
// un correo de prueba a tu propia cuenta.
function _authorizeMail() {
  var to = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: "[Registro Consumos] Test autorización MailApp",
    body: "Si recibes esto, el scope MailApp quedó autorizado.",
  });
  return { ok: true, to: to, remaining: MailApp.getRemainingDailyQuota() };
}

// ----- Notificación cola Fotos -------------------------------------------
// Recibe { sucursal, tipo, periodo, link, total, fileName } y manda mail a
// los destinatarios configurados (key "fotoNotifEmails" en hoja Config).

function notifyFotoPending(body) {
  var cfg = getConfigValue("fotoNotifEmails");
  var emails = (cfg && Array.isArray(cfg.value)) ? cfg.value : [];
  emails = emails
    .map(function (e) { return String(e || "").trim(); })
    .filter(function (e) { return e && e.indexOf("@") !== -1; });
  if (!emails.length) return { ok: true, sent: 0, reason: "no recipients" };

  var sucursal = body.sucursal || "—";
  var tipo     = body.tipo     || "—";
  var periodo  = body.periodo  || "—";
  var link     = body.link     || "";
  var total    = body.total    != null ? body.total : "?";
  var fileName = body.fileName || "";

  var subject = "[Registro Consumos] Nueva foto pendiente · " + sucursal;
  var lines = [
    "Se subió una nueva foto al módulo Tomar foto. Queda pendiente de completar datos.",
    "",
    "Sucursal: " + sucursal,
    "Tipo: "     + tipo,
    "Período: "  + periodo,
    "Archivo: "  + (fileName || "—"),
    "Drive: "    + (link || "—"),
    "",
    "Total pendientes en cola: " + total,
    "",
    "Para completar los datos abre la app o edita la fila en la planilla.",
  ];
  var sent = 0;
  emails.forEach(function (to) {
    try {
      MailApp.sendEmail({ to: to, subject: subject, body: lines.join("\n") });
      sent++;
    } catch (e) {
      // continúa con los demás
    }
  });
  return { ok: true, sent: sent, recipients: emails.length };
}

// ----- Fotos (módulo "Tomar foto") --------------------------------------
// La hoja "Fotos" se crea automáticamente en el primer `append` usando
// WEB_CFG.HEADERS.Fotos. uploadFile / appendRows / updateCell / moveFile ya
// existen; sólo agregamos el getter de lectura de la cola.
function getFotos() {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName("Fotos");
  if (!sheet) return { rows: [] };
  var data = sheet.getDataRange().getDisplayValues();
  return { rows: data.slice(1) };
}

// ----- Genérico: lectura/escritura de una hoja por nombre --------------------
// Usado por el módulo Medidores (hojas Medidores / Lecturas Medidor / Precios
// Medidor). getSheetRows devuelve las filas sin encabezado; setSheetRows hace
// clear+rewrite con el encabezado de WEB_CFG.HEADERS (mismo patrón que setEmissions).

function getSheetRows(name) {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) return { rows: [] };
  var data = sheet.getDataRange().getDisplayValues();
  return { rows: data.slice(1) };
}

function setSheetRows(name, rows) {
  var ss = rcSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clear();
  var headers = WEB_CFG.HEADERS[name];
  if (headers) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows && rows.length) {
    var width = headers ? headers.length : rows[0].length;
    // Normaliza ancho de cada fila al del encabezado.
    var norm = rows.map(function (r) {
      var out = r.slice(0, width);
      while (out.length < width) out.push("");
      return out;
    });
    sheet.getRange(2, 1, norm.length, width).setValues(norm);
  }
}

// ----- Provisión de la instancia (acción "setup") -------------------------
// Crea las hojas y el árbol de carpetas de Drive bajo UNA carpeta raíz, y deja
// los IDs en la clave `driveFolders` de la hoja "Config". La app los lee de ahí
// (lib/drive-folders.js), así agregar un proveedor no obliga a redeployar nada.
//
// Idempotente: las carpetas se buscan por nombre antes de crearse, así que
// correrlo de nuevo devuelve los mismos IDs.
//
// Uso:
//   curl -L -X POST "<URL>/exec" -H "Content-Type: text/plain" \
//     -d '{"action":"setup","rootFolderId":"<id de la carpeta raíz>"}'

// Proveedores con carpeta dedicada. La clave es el id que usa la app
// (RC_CONFIG.PROVIDER_FOLDERS en el prototipo); el valor, el nombre visible.
var RC_PROVIDERS = [
  ["enel",           "Enel"],
  ["cge",            "CGE"],
  ["aguas-andinas",  "Aguas Andinas"],
  ["aguas-del-valle","Aguas del Valle"],
  ["esval",          "ESVAL"],
  ["iconstruye-pet", "Iconstruye Petróleo"],
  ["copec",          "Copec"],
  ["shell",          "Shell"],
];

// Tipos de consumo con carpeta propia de respaldos de lectura.
var RC_RESPALDO_TYPES = [["agua", "Agua"], ["combustible", "Combustible"], ["electricidad", "Electricidad"]];

function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function setupInstance(rootFolderId) {
  ensureSheets();
  if (!rootFolderId) throw new Error("rootFolderId missing: pasa el ID de la carpeta raíz de Drive.");
  var root = DriveApp.getFolderById(rootFolderId);

  var fotos = childFolder(root, "Fotos");
  var facturas = childFolder(root, "Facturas");
  var medidores = childFolder(root, "Medidores");
  var respaldos = childFolder(medidores, "Respaldos");
  var proveedores = childFolder(root, "Proveedores");

  var folders = {
    fotosPorCompletar: childFolder(fotos, "Por completar").getId(),
    fotosProcesados:   childFolder(fotos, "Procesados").getId(),
    manualFacturas:    childFolder(facturas, "Registro manual").getId(),
    uploadFacturas:    childFolder(facturas, "Documentos subidos").getId(),
    medidorFacturas:   childFolder(medidores, "Facturas").getId(),
    medidorPagos:      childFolder(medidores, "Pagos").getId(),
    medidorRespaldos:  {},
    proveedores:       {},
  };

  RC_RESPALDO_TYPES.forEach(function (t) {
    folders.medidorRespaldos[t[0]] = childFolder(respaldos, t[1]).getId();
  });

  RC_PROVIDERS.forEach(function (p) {
    var dir = childFolder(proveedores, p[1]);
    folders.proveedores[p[0]] = {
      porProcesar: childFolder(dir, "Por procesar").getId(),
      procesados:  childFolder(dir, "Procesados").getId(),
    };
  });

  setConfigValue("driveFolders", folders);
  var ss = rcSpreadsheet();
  return {
    ok: true,
    version: SCRIPT_VERSION,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    rootFolder: { id: root.getId(), name: root.getName(), url: root.getUrl() },
    folders: folders,
  };
}
