import "server-only";
import { apiGet, apiPost, TAGS } from "../apps-script";

// Emisiones ↔ hoja "Emisiones". Un solo esquema de 7 columnas guarda cuatro
// cosas distintas, discriminadas por el "scope" de la columna 1:
//
//   factor-empresa  | ""    | key            | value    | ""            | ""   | ""
//   factor-sucursal | sucId | key            | value    | pendingReview | ""   | ""
//   refrigerante    | sucId | uid            | cargaKg  | ""            | tipo | mes
//   meta-empresa    | ""    | campo de meta  | value    | ""            | ""   | ""
//   meta-sucursal   | sucId | campo de meta  | value    | ""            | ""   | ""

const META_FIELDS = ["absoluta", "relativa", "anioBase", "baseEmissions", "baseMode"];

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

export async function writeEmissions(emissions) {
  await apiPost({ action: "setEmissions", rows: flatten(emissions) });
}
