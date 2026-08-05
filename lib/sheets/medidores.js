import "server-only";
import { apiGet, apiPostSoloSdk, TAGS } from "../apps-script";
import { toNumber } from "../domain/parse";
import { nextReadingId } from "../domain/ids";

// Módulo Medidores: hojas "Medidores", "Lecturas Medidor" y "Precios Medidor".
// Los documentos adjuntos (factura, pago, respaldo) viajan dentro de la fila de la
// lectura: una fila por (medidor, mes) con lectura y/o links de Drive.
//
// La escritura NO es clear+rewrite. Antes lo era —aplanaba el módulo completo y
// reemplazaba las tres hojas, igual que emisiones y config— y ese era el modo de
// falla real del módulo: la planilla quedaba igual a la copia del último que
// guardó, así que dos dispositivos editando a la vez se borraban el trabajo. Ahora
// se escriben solo las filas del patch, identificadas por su clave natural.
//
// Ver lib/domain/medidores-patch.js para por qué el patch lo calcula el cliente.

// ----- Filas ---------------------------------------------------------------
// Una función por entidad, no un aplanado del módulo entero: al escribir por clave
// nunca se necesita la tabla completa. Que no exista un `flattenMeters(M.meters)`
// es parte del arreglo — no había forma de llamarlo sin materializar la tabla.

/** Medidores: [id, sucursal, tipo, nombre, numero, activo, facturable] */
export function filaMedidor(m) {
  return [
    m.id,
    m.sucursal || "",
    m.type || "",
    m.nombre || "",
    m.numero || "",
    m.activo ? "Sí" : "No",
    m.facturable === false ? "No" : "Sí",
  ];
}

export function unflattenMeters(rows) {
  return (rows || [])
    .filter((r) => r[0])
    .map((r) => ({
      id: r[0],
      sucursal: r[1] || "",
      type: r[2] || "",
      nombre: r[3] || "",
      numero: r[4] != null ? String(r[4]) : "",
      activo: String(r[5]).trim().toLowerCase() !== "no",
      // Columna agregada después: vacío se lee como facturable.
      facturable: String(r[6] == null ? "" : r[6]).trim().toLowerCase() !== "no",
    }));
}

const docCells = (d) => [d ? d.link || "" : "", d ? d.name || "" : "", d ? d.fileId || "" : ""];

/**
 * Lecturas + docs: [id, meterId, periodo, lectura,
 *                   facturaLink, facturaNombre, facturaFileId,
 *                   pagoLink, pagoNombre, pagoFileId,
 *                   respaldoLink, respaldoNombre, respaldoFileId]
 *
 * El id se acuña acá y solo lo usa `upsertPorClave` si la fila es nueva: si ya
 * existe, gana el que tiene la planilla. La clave de verdad es (meterId, periodo),
 * porque `setReading` genera un id nuevo en cada tecla y ese id no identifica nada.
 *
 * `nextReadingId` depende del reloj, y su archivo advierte que no puede correr en el
 * render del servidor. Acá corre dentro de una Server Action, no en un render: no
 * hay hidratación que romper.
 */
export function filaLectura(e) {
  return [
    nextReadingId(),
    e.meterId,
    e.month,
    e.lectura == null ? "" : e.lectura,
    ...docCells(e.factura),
    ...docCells(e.pago),
    ...docCells(e.respaldo),
  ];
}

export function unflattenReadings(rows) {
  const readings = [];
  const docs = {};
  for (const r of rows || []) {
    const id = r[0] || "";
    const meterId = r[1] || "";
    const month = r[2] || "";
    if (!meterId || !month) continue;

    // El Sheet devuelve display values ("15771,848"): toNumber normaliza.
    const lectura = r[3];
    if (lectura !== "" && lectura != null) {
      readings.push({
        id: id || `lec_${meterId}_${month}`,
        meterId,
        month,
        lectura: toNumber(lectura),
      });
    }

    const [fLink, fName, fId] = [r[4] || "", r[5] || "", r[6] || ""];
    const [pLink, pName, pId] = [r[7] || "", r[8] || "", r[9] || ""];
    const [rLink, rName, rId] = [r[10] || "", r[11] || "", r[12] || ""];
    if (fLink || pLink || rLink) {
      const key = `${meterId}__${month}`;
      docs[key] = {};
      if (fLink) docs[key].factura = { link: fLink, name: fName, fileId: fId };
      if (pLink) docs[key].pago = { link: pLink, name: pName, fileId: pId };
      if (rLink) docs[key].respaldo = { link: rLink, name: rName, fileId: rId };
    }
  }
  return { readings, docs };
}

/** Precios: [sucursal, tipo, periodo, precio] */
export function filaPrecio(p) {
  return [p.sucursal || "", p.type || "", p.month || "", p.precio];
}

export function unflattenPrices(rows) {
  return (rows || [])
    .filter((r) => r[0] && r[2])
    .map((r) => ({ sucursal: r[0], type: r[1] || "", month: r[2], precio: toNumber(r[3]) }));
}

// ----- Lectura -------------------------------------------------------------

/** Estado completo del módulo: { meters, readings, prices, docs }. */
export async function readMedidores() {
  const opts = { tag: TAGS.medidores, revalidate: 30 };
  const [med, lec, pre] = await Promise.all([
    apiGet({ action: "getMedidores" }, opts),
    apiGet({ action: "getLecturasMedidor" }, opts),
    apiGet({ action: "getPreciosMedidor" }, opts),
  ]);
  const { readings, docs } = unflattenReadings((lec && lec.rows) || []);
  return {
    meters: unflattenMeters((med && med.rows) || []),
    readings,
    prices: unflattenPrices((pre && pre.rows) || []),
    docs,
  };
}

// ----- Escritura -----------------------------------------------------------

// Qué hoja atiende cada parte del patch, cómo se arma su fila, y qué valores
// identifican una fila a borrar. El orden de `clave` tiene que coincidir con
// CLAVE_DE de lib/google/actions.js: son las mismas columnas.
const PARTES = [
  {
    parte: "meters",
    action: "upsertMedidores",
    fila: filaMedidor,
    clave: (id) => [id],
  },
  {
    parte: "readings",
    action: "upsertLecturasMedidor",
    fila: filaLectura,
    clave: (r) => [r.meterId, r.month],
  },
  {
    parte: "prices",
    action: "upsertPreciosMedidor",
    fila: filaPrecio,
    clave: (p) => [p.sucursal, p.type || "", p.month],
  },
];

/**
 * Aplica un patch del módulo: escribe las filas que cambiaron y borra las que se
 * quitaron. Nunca toca una fila que no venga en el patch.
 *
 * Una hoja sin cambios no genera ninguna llamada. Eso importa más de lo que
 * parece: el caso normal —escribir la lectura de un medidor— tocaba antes las tres
 * hojas con una reescritura completa cada una, y ahora es una lectura y una
 * escritura de una sola hoja.
 *
 * Secuencial por hoja, no en paralelo: cada `upsert*` lee su hoja para indexarla
 * antes de escribir, y la cuota de la API de Sheets se cuenta por request. Con un
 * patch normal esto es un solo paso, así que no hay latencia que ganar.
 *
 * Devuelve los conteos por action ({ escritas, agregadas, borradas }), que es lo
 * que la Server Action registra en el log: antes un guardado no dejaba rastro de
 * cuántas filas había movido.
 */
export async function upsertMedidores(patch) {
  const out = {};
  for (const { parte, action, fila, clave } of PARTES) {
    const p = (patch && patch[parte]) || {};
    const rows = (p.upsert || []).map(fila);
    const remove = (p.remove || []).map(clave);
    if (!rows.length && !remove.length) continue;
    out[action] = await apiPostSoloSdk({ action, rows, remove });
  }
  return out;
}
