// Patch del módulo Medidores: qué cambió ESTE cliente, no cómo cree que está la
// planilla completa.
//
// Por qué existe
// --------------
// La pantalla de Medidores mantiene el módulo entero en memoria y guardaba
// mandándolo completo, lo que se traducía en reescribir las tres hojas
// (`reemplazarHoja`). Con el Apps Script eso lo tapaba a medias un LockService de
// 30s; el SDK no tiene lock, así que dos dispositivos editando a la vez se pisan
// entero: el último en guardar deja la planilla igual a SU copia y borra lo del
// otro.
//
// Diffear en el servidor contra la planilla NO alcanza. Si el cliente manda el
// módulo completo, "esta fila no está en lo que mandé" es ambiguo entre "la borré"
// y "nunca la vi". Un diff contra la hoja leería lo segundo como lo primero y
// seguiría borrando trabajo ajeno.
//
// La salida es diffear contra el propio estado confirmado del cliente: lo último
// que se sabe escrito en la planilla, comparado con lo que hay ahora en pantalla.
// Esa diferencia son exactamente las ediciones de este cliente, y ahí la ausencia
// sí significa "la borré". Lo que nunca tocó no viaja, así que no puede pisarlo.
//
// Claves
// ------
// Cada entidad viaja con su clave natural, y el servidor escribe por clave en vez
// de por posición de fila:
//
//   medidor  → id
//   lectura  → (meterId, month)   — la lectura y sus documentos comparten fila
//   precio   → (sucursal, type, month)
//
// La lectura se identifica por (medidor, mes) y no por su columna ID a propósito:
// `setReading` acuña un `nextReadingId()` nuevo en cada tecla, así que ese id no
// es estable entre ediciones y no sirve como clave. El servidor conserva el que ya
// tenga la fila (ver `upsertPorClave`).
//
// Este archivo no importa nada del servidor: corre en el cliente, que es donde se
// conoce el "antes".

export const claveLectura = (meterId, month) => `${meterId}__${month}`;

/** Descompone la clave de `M.docs`, que ya venía con este formato del prototipo. */
export function partesClaveLectura(clave) {
  const i = String(clave).indexOf("__");
  if (i < 0) return null;
  const meterId = clave.slice(0, i);
  const month = clave.slice(i + 2);
  return meterId && month ? { meterId, month } : null;
}

// Separador que no puede aparecer en un nombre de sucursal escrito a mano: con un
// "|" o un espacio, ("Planta A", "") y ("Planta", "A") darían la misma clave.
const SEP = "\u0000";

export const clavePrecio = (p) =>
  [p.sucursal || "", p.type || "", p.month || ""].join(SEP);

// ----- Normalización ------------------------------------------------------
//
// Los dos lados del diff no vienen del mismo lugar: el "antes" salió de la
// planilla (`unflattenMeters` y compañía) y el "después" de las transformaciones
// de dominio. Comparar sin normalizar marcaría como cambio un `undefined` contra
// `""` o un `"120"` contra `120`, y cada guardado reescribiría filas intactas.

const texto = (v) => (v == null ? "" : String(v));
const numero = (v) => (v === "" || v == null ? "" : Number(v));

function medidorNorm(m) {
  return {
    id: texto(m.id),
    sucursal: texto(m.sucursal),
    type: texto(m.type),
    nombre: texto(m.nombre),
    numero: texto(m.numero),
    // Vacío se lee como activo/facturable, igual que `unflattenMeters`.
    activo: m.activo !== false,
    facturable: m.facturable !== false,
  };
}

/** Un documento sin link ni fileId es un hueco, no un documento. */
function docNorm(d) {
  if (!d) return null;
  const link = texto(d.link);
  const fileId = texto(d.fileId);
  if (!link && !fileId) return null;
  return { link, name: texto(d.name), fileId };
}

function precioNorm(p) {
  return {
    sucursal: texto(p.sucursal),
    type: texto(p.type),
    month: texto(p.month),
    precio: numero(p.precio),
  };
}

/**
 * Lecturas y documentos aplanados a una entrada por (medidor, mes), que es lo que
 * ocupa una fila de la hoja.
 *
 * Una entrada sin lectura y sin ningún documento no existe: `setDoc(null)` deja en
 * `M.docs` una clave con los tres documentos en null, y tratarla como entrada
 * sembraba filas vacías en la planilla.
 */
export function lecturasPorClave(M) {
  const out = new Map();
  const nueva = (meterId, month) => ({
    meterId,
    month,
    lectura: "",
    factura: null,
    pago: null,
    respaldo: null,
  });

  for (const r of (M && M.readings) || []) {
    if (!r || !r.meterId || !r.month) continue;
    const e = nueva(texto(r.meterId), texto(r.month));
    e.lectura = numero(r.lectura);
    out.set(claveLectura(e.meterId, e.month), e);
  }

  for (const [clave, d] of Object.entries((M && M.docs) || {})) {
    const partes = partesClaveLectura(clave);
    if (!partes) continue;
    const e = out.get(clave) || nueva(partes.meterId, partes.month);
    e.factura = docNorm(d && d.factura);
    e.pago = docNorm(d && d.pago);
    e.respaldo = docNorm(d && d.respaldo);
    out.set(clave, e);
  }

  for (const [clave, e] of out) {
    if (e.lectura === "" && !e.factura && !e.pago && !e.respaldo) out.delete(clave);
  }
  return out;
}

// ----- Diff ---------------------------------------------------------------

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compara dos mapas clave → entrada normalizada.
 * `aBorrado` traduce una clave a lo que el servidor necesita para encontrar su fila.
 */
function diffMapas(antes, despues, aBorrado) {
  const upsert = [];
  const remove = [];
  for (const [clave, entrada] of despues) {
    const previo = antes.get(clave);
    if (!previo || !igual(previo, entrada)) upsert.push(entrada);
  }
  for (const [clave, entrada] of antes) {
    if (!despues.has(clave)) remove.push(aBorrado(clave, entrada));
  }
  return { upsert, remove };
}

const porId = (lista) =>
  new Map(
    ((lista || []).filter((m) => m && m.id) || []).map((m) => [texto(m.id), medidorNorm(m)]),
  );

const porClavePrecio = (lista) =>
  new Map(
    (lista || [])
      .filter((p) => p && p.sucursal && p.month)
      .map((p) => [clavePrecio(p), precioNorm(p)]),
  );

/**
 * Estado confirmado → estado actual, como operaciones por clave.
 *
 * `antes` tiene que ser lo último que se sabe escrito en la planilla, no lo que la
 * planilla tiene ahora: es la diferencia entre "esto lo borré yo" y "esto lo
 * escribió alguien más y yo no lo tenía".
 */
export function diffMedidores(antes, despues) {
  const a = antes || {};
  const b = despues || {};
  return {
    meters: diffMapas(porId(a.meters), porId(b.meters), (id) => id),
    readings: diffMapas(lecturasPorClave(a), lecturasPorClave(b), (clave, e) => ({
      meterId: e.meterId,
      month: e.month,
    })),
    prices: diffMapas(porClavePrecio(a.prices), porClavePrecio(b.prices), (clave, e) => ({
      sucursal: e.sucursal,
      type: e.type,
      month: e.month,
    })),
  };
}

const PARTES = ["meters", "readings", "prices"];

export function patchVacio(patch) {
  if (!patch) return true;
  return PARTES.every((k) => {
    const p = patch[k];
    return !p || (!(p.upsert || []).length && !(p.remove || []).length);
  });
}

/** Conteos por parte, para el log del servidor y los mensajes de error. */
export function resumenPatch(patch) {
  const out = {};
  for (const k of PARTES) {
    const p = (patch && patch[k]) || {};
    const escritas = (p.upsert || []).length;
    const borradas = (p.remove || []).length;
    if (escritas || borradas) out[k] = { escritas, borradas };
  }
  return out;
}
