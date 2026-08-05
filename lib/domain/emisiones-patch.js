// Patch de la hoja "Emisiones": qué cambió este cliente, no la tabla completa.
//
// Mismo problema y misma salida que lib/domain/medidores-patch.js — leer ese
// archivo primero, ahí está el razonamiento de por qué el diff se calcula contra
// el estado confirmado del cliente y no contra la planilla.
//
// Lo propio de Emisiones es que una sola hoja de 7 columnas guarda cuatro cosas
// distintas, discriminadas por el "scope" de la columna 1, y no todas tienen la
// misma granularidad de identidad:
//
//   factor-empresa  | ""    | key           | value    | ""            | ""   | ""
//   factor-sucursal | sucId | key           | value    | pendingReview | ""   | ""
//   refrigerante    | sucId | uid           | cargaKg  | ""            | tipo | mes
//   meta-empresa    | ""    | campo de meta | value    | ""            | ""   | ""
//   meta-sucursal   | sucId | campo de meta | value    | ""            | ""   | ""
//
// Factores y metas van POR FILA, con clave (scope, sucId, key).
//
// Refrigerantes van POR GRUPO: se reemplazan todas las filas de una (sucursal),
// como hace `upsertSucursal` con Config Sucursales. La razón es que su clave
// natural sería el `uid`, y `flatten` lo escribe como `rf.uid || ""` — una fila
// tecleada a mano en la planilla no tiene uid, y dos filas sin uid de la misma
// sucursal colapsarían en la misma clave, perdiendo una. Además la UI los edita
// como lista por sucursal (`factores.jsx`), así que el grupo coincide con la
// unidad de edición real.
//
// Lo que eso deja sin resolver, dicho explícito: dos personas editando los
// refrigerantes de LA MISMA sucursal al mismo tiempo siguen siendo last-write-wins.
// Pero el alcance pasó de "la hoja Emisiones entera" a "los refrigerantes de una
// sucursal", y sucursales distintas ya no se pisan.

// Campos de meta que se persisten. Vive acá, del lado del cliente, porque el diff
// necesita saber exactamente qué filas produce el guardado.
export const META_FIELDS = ["absoluta", "relativa", "anioBase", "baseEmissions", "baseMode"];

const SEP = "\u0000";

export const claveEmision = (e) => [e.scope, e.sucId || "", e.key].join(SEP);

const texto = (v) => (v == null ? "" : String(v).trim());

/**
 * Un valor de la hoja puede ser número (factores, cargas, años) o texto
 * (`baseMode`). El "antes" pasó por `parseFloat` al leerse y el "después" viene de
 * un input, así que 2.5 y "2.5" tienen que comparar igual o cada guardado
 * reescribiría filas intactas.
 */
function valorNorm(v) {
  if (v == null || texto(v) === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : texto(v);
}

/**
 * Las filas por clave que produce un objeto de emisiones. Replica las reglas de
 * inclusión de `flatten` (lib/sheets/emissions.js): los factores se escriben
 * siempre, las metas solo cuando tienen valor.
 */
export function filasPorClave(emissions) {
  const e = emissions || {};
  const out = new Map();
  const poner = (entrada) => out.set(claveEmision(entrada), entrada);

  for (const [key, v] of Object.entries(e.factoresEmpresa || {})) {
    poner({ scope: "factor-empresa", sucId: "", key, value: valorNorm(v && v.value) });
  }

  for (const [sucId, porKey] of Object.entries(e.factoresSucursal || {})) {
    for (const [key, v] of Object.entries(porKey || {})) {
      poner({
        scope: "factor-sucursal",
        sucId,
        key,
        value: valorNorm(v && v.value),
        pendingReview: !!(v && v.pendingReview),
      });
    }
  }

  const empresa = (e.metas && e.metas.empresa) || {};
  for (const key of META_FIELDS) {
    if (empresa[key] != null && empresa[key] !== "") {
      poner({ scope: "meta-empresa", sucId: "", key, value: valorNorm(empresa[key]) });
    }
  }

  for (const [sucId, m] of Object.entries((e.metas && e.metas.sucursales) || {})) {
    for (const key of META_FIELDS) {
      if (m && m[key] != null && m[key] !== "") {
        poner({ scope: "meta-sucursal", sucId, key, value: valorNorm(m[key]) });
      }
    }
  }

  return out;
}

/** Refrigerantes normalizados por sucursal, en el orden en que se escriben. */
export function refrigerantesPorSucursal(emissions) {
  const out = new Map();
  for (const [sucId, arr] of Object.entries((emissions || {}).refrigerantesSucursal || {})) {
    out.set(
      sucId,
      (arr || []).map((rf) => ({
        uid: texto(rf.uid),
        tipo: texto(rf.tipo),
        cargaKg: rf.cargaKg == null ? "" : valorNorm(rf.cargaKg),
        mes: texto(rf.mes),
      })),
    );
  }
  return out;
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Estado confirmado → estado actual.
 *
 * Devuelve `{ filas: { upsert, remove }, grupos }`. Un grupo con `items: []`
 * significa "borrar todos los refrigerantes de esta sucursal".
 */
export function diffEmisiones(antes, despues) {
  const a = filasPorClave(antes);
  const b = filasPorClave(despues);

  const upsert = [];
  const remove = [];
  for (const [clave, entrada] of b) {
    const previo = a.get(clave);
    if (!previo || !igual(previo, entrada)) upsert.push(entrada);
  }
  for (const [clave, entrada] of a) {
    if (!b.has(clave)) {
      remove.push({ scope: entrada.scope, sucId: entrada.sucId || "", key: entrada.key });
    }
  }

  const rA = refrigerantesPorSucursal(antes);
  const rB = refrigerantesPorSucursal(despues);
  const grupos = [];
  for (const [sucId, items] of rB) {
    if (!igual(rA.get(sucId) || [], items)) grupos.push({ sucId, items });
  }
  for (const [sucId] of rA) {
    if (!rB.has(sucId)) grupos.push({ sucId, items: [] });
  }

  return { filas: { upsert, remove }, grupos };
}

export function patchEmisionesVacio(patch) {
  if (!patch) return true;
  const f = patch.filas || {};
  return (
    !(f.upsert || []).length && !(f.remove || []).length && !(patch.grupos || []).length
  );
}

/** Conteos, para el log del servidor. */
export function resumenPatchEmisiones(patch) {
  const f = (patch && patch.filas) || {};
  const grupos = (patch && patch.grupos) || [];
  return {
    escritas: (f.upsert || []).length,
    borradas: (f.remove || []).length,
    gruposReemplazados: grupos.length,
    filasDeGrupos: grupos.reduce((n, g) => n + (g.items || []).length, 0),
  };
}
