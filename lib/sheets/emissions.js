import "server-only";
import { apiGet, apiPostSoloSdk, TAGS } from "../apps-script";
import { META_FIELDS } from "../domain/emisiones-patch";

// Emisiones ↔ hoja "Emisiones". Un solo esquema de 7 columnas guarda cuatro
// cosas distintas, discriminadas por el "scope" de la columna 1:
//
//   factor-empresa  | ""    | key            | value    | ""            | ""   | ""
//   factor-sucursal | sucId | key            | value    | pendingReview | ""   | ""
//   refrigerante    | sucId | uid            | cargaKg  | ""            | tipo | mes
//   meta-empresa    | ""    | campo de meta  | value    | ""            | ""   | ""
//   meta-sucursal   | sucId | campo de meta  | value    | ""            | ""   | ""

// META_FIELDS vive en lib/domain/emisiones-patch.js: el diff corre en el cliente y
// necesita saber qué filas produce el guardado, así que la lista tiene un solo
// dueño y es el que los dos lados pueden importar.

export function flatten(emissions) {
  const rows = [];
  const e = emissions || {};

  for (const [k, v] of Object.entries(e.factoresEmpresa || {})) {
    rows.push(["factor-empresa", "", k, v && v.value != null ? v.value : "", "", "", ""]);
  }

  for (const [sucId, byKey] of Object.entries(e.factoresSucursal || {})) {
    for (const [k, v] of Object.entries(byKey || {})) {
      rows.push([
        "factor-sucursal",
        sucId,
        k,
        v && v.value != null ? v.value : "",
        v && v.pendingReview ? "Sí" : "No",
        "",
        "",
      ]);
    }
  }

  for (const [sucId, arr] of Object.entries(e.refrigerantesSucursal || {})) {
    for (const rf of arr || []) {
      rows.push([
        "refrigerante",
        sucId,
        rf.uid || "",
        rf.cargaKg != null ? rf.cargaKg : "",
        "",
        rf.tipo || "",
        rf.mes || "",
      ]);
    }
  }

  const empresa = (e.metas && e.metas.empresa) || {};
  for (const k of META_FIELDS) {
    if (empresa[k] != null && empresa[k] !== "") {
      rows.push(["meta-empresa", "", k, empresa[k], "", "", ""]);
    }
  }

  for (const [sucId, m] of Object.entries((e.metas && e.metas.sucursales) || {})) {
    for (const k of META_FIELDS) {
      if (m && m[k] != null && m[k] !== "") {
        rows.push(["meta-sucursal", sucId, k, m[k], "", "", ""]);
      }
    }
  }

  return rows;
}

export function unflatten(rows) {
  const out = {
    factoresEmpresa: {},
    factoresSucursal: {},
    refrigerantesSucursal: {},
    metas: { empresa: {}, sucursales: {} },
  };

  for (const r of rows || []) {
    const scope = String(r[0] || "").trim();
    const sucId = String(r[1] || "").trim();
    const key = String(r[2] || "").trim();
    const raw = r[3];

    if (scope === "factor-empresa" && key) {
      const n = parseFloat(raw);
      if (!isNaN(n)) out.factoresEmpresa[key] = { value: n };
    } else if (scope === "factor-sucursal" && key && sucId) {
      const n = parseFloat(raw);
      if (!isNaN(n)) {
        out.factoresSucursal[sucId] ||= {};
        const p = String(r[4] || "").trim().toLowerCase();
        out.factoresSucursal[sucId][key] = { value: n, pendingReview: p === "sí" || p === "si" };
      }
    } else if (scope === "refrigerante" && sucId) {
      out.refrigerantesSucursal[sucId] ||= [];
      const carga = parseFloat(raw);
      out.refrigerantesSucursal[sucId].push({
        uid: key || "",
        tipo: String(r[5] || "").trim(),
        cargaKg: isNaN(carga) ? 0 : carga,
        mes: String(r[6] || "").trim(),
      });
    } else if (scope === "meta-empresa" && key) {
      const n = parseFloat(raw);
      out.metas.empresa[key] = isNaN(n) ? raw : n;
    } else if (scope === "meta-sucursal" && key && sucId) {
      out.metas.sucursales[sucId] ||= {};
      const n = parseFloat(raw);
      out.metas.sucursales[sucId][key] = isNaN(n) ? raw : n;
    }
  }

  return out;
}

export function hasContent(em) {
  if (!em) return false;
  if (Object.keys(em.factoresEmpresa || {}).length) return true;
  if (Object.keys(em.factoresSucursal || {}).length) return true;
  if (Object.keys(em.refrigerantesSucursal || {}).length) return true;
  if (em.metas && Object.keys(em.metas.empresa || {}).length) return true;
  if (em.metas && Object.keys(em.metas.sucursales || {}).length) return true;
  return false;
}

/**
 * Devuelve null (no un objeto vacío) cuando la hoja no tiene filas, para que
 * quien llame distinga "nunca se guardó" de "guardado sin contenido" y pueda
 * sembrar los factores por defecto.
 */
export async function readEmissions() {
  const data = await apiGet({ action: "getEmissions" }, { tag: TAGS.emissions, revalidate: 60 });
  const rows = (data && data.rows) || [];
  if (!rows.length) return null;
  return unflatten(rows);
}

// ----- Escritura -----------------------------------------------------------
//
// `flatten` (arriba) sigue existiendo porque documenta el layout y lo usa la
// verificación de migración, pero la app ya NO escribe la hoja completa: antes cada
// guardado de factores o metas hacía `clear()` + reescribir, así que dos personas
// editando a la vez se borraban el trabajo. Ahora se escriben las filas del patch.
//
// Ver lib/domain/emisiones-patch.js, y lib/domain/medidores-patch.js para el
// razonamiento de fondo.

/** Entrada del patch → fila de la hoja. */
function filaEmision(e) {
  const valor = e.value == null ? "" : e.value;
  // Solo factor-sucursal usa la columna "Pending Review". Las demás la dejan vacía,
  // igual que `flatten`: escribir "No" en todas ensuciaría filas que hoy están en
  // blanco, y nadie las lee.
  if (e.scope === "factor-sucursal") {
    return [e.scope, e.sucId || "", e.key, valor, e.pendingReview ? "Sí" : "No", "", ""];
  }
  return [e.scope, e.sucId || "", e.key, valor, "", "", ""];
}

/** Refrigerante → fila. El grupo lo arma `upsertEmissions`. */
function filaRefrigerante(sucId, rf) {
  return [
    "refrigerante",
    sucId,
    rf.uid || "",
    rf.cargaKg == null ? "" : rf.cargaKg,
    "",
    rf.tipo || "",
    rf.mes || "",
  ];
}

/**
 * Aplica un patch de emisiones. Devuelve los conteos que quedaron escritos, que es
 * lo que la Server Action registra: antes un guardado no dejaba ningún rastro.
 */
export async function upsertEmissions(patch) {
  const filas = (patch && patch.filas) || {};
  const grupos = (patch && patch.grupos) || [];

  return apiPostSoloSdk({
    action: "upsertEmisiones",
    rows: (filas.upsert || []).map(filaEmision),
    // El orden de la clave tiene que coincidir con CLAVE_EMISIONES de
    // lib/google/actions.js: scope, Sucursal ID, Key.
    remove: (filas.remove || []).map((e) => [e.scope, e.sucId || "", e.key]),
    grupos: grupos.map((g) => ({
      // CLAVE_GRUPO_EMISIONES: scope, Sucursal ID.
      clave: ["refrigerante", g.sucId],
      rows: (g.items || []).map((rf) => filaRefrigerante(g.sucId, rf)),
    })),
  });
}
