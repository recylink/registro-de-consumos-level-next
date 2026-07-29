import "server-only";

// Reporte "Estado de medidores": página A4 lista para imprimir o bajar como PDF.
// Portado de medDownloadReport en proto/medidores.jsx.
//
// En el prototipo esta función abría una ventana con window.open("") y le
// escribía el HTML con document.write, así que el reporte solo existía mientras
// esa pestaña estuviera viva: no se podía compartir el link ni recargarlo. Acá el
// HTML lo devuelve una ruta del servidor (/medidores/reporte), que es un link
// normal con sus parámetros.
//
// Los estilos van en atributos style a propósito: es un documento suelto, sin
// acceso a las hojas de estilo de la app.

import { fmtCLP, fmtNum, monthLabelShort } from "../domain/format";
import { medColorAt, metersFor } from "../domain/medidores";
import {
  boletaFor,
  consumoFor,
  costoFor,
  MED_TYPES,
  medFacturable,
  medUnit,
  meterReadingFor,
  payStatus,
} from "../domain/medidores-calc";
import { SCOPES } from "../domain/emisiones";
import { esFactorPropio, factorFor, sucursalesSinFactor } from "../domain/emisiones-calc";
import { getSubcatsFor } from "../domain/sucursales";
import { periodToMonthKeys } from "../domain/periods";
import { smoothPath } from "@/components/charts/smooth";

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const num = (v) => (v == null ? "—" : fmtNum(v));
const money = (v) => (v == null ? "—" : fmtCLP(v));
const coma = (v) => String(v).replace(".", ",");
const pct = (v) => (v > 0 ? "+" : "") + coma(v.toFixed(2)) + "%";

const TYPE_ICON = {
  electricidad: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>',
  agua: '<path d="M12 2.69 5.64 9.06a9 9 0 1 0 12.72 0L12 2.69z"></path>',
  combustible:
    '<path d="M3 22h12V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v18z"></path><line x1="3" y1="10" x2="15" y2="10"></line>',
};

const PAY_STYLE = {
  pagado: ["#ECFDF3", "#027A48", "#12B76A", "Pagado"],
  facturado: ["#E6F4FB", "#0069A6", "#0069A6", "Facturado"],
  "por-facturar": ["#FFFAEB", "#B54708", "#F79009", "Por facturar"],
};

const payChip = (st) => {
  const S = PAY_STYLE[st];
  return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:10px;font-weight:600;background:${S[0]};color:${S[1]};"><span style="width:6px;height:6px;border-radius:999px;background:${S[2]};"></span>${S[3]}</span>`;
};

/** Fecha del servidor en horario de Chile: el reporte lleva fecha de emisión. */
function fechas(now) {
  const opts = { timeZone: "America/Santiago" };
  const corta = now.toLocaleDateString("es-CL", { ...opts, day: "2-digit", month: "2-digit", year: "numeric" });
  const larga =
    now.toLocaleDateString("es-CL", { ...opts, day: "2-digit", month: "long", year: "numeric" }) +
    " · " +
    now.toLocaleTimeString("es-CL", { ...opts, hour: "2-digit", minute: "2-digit", hour12: false }) +
    " hrs";
  return { corta, larga };
}

/**
 * Factor de emisión que aplica al consumo de los medidores, o el motivo por el
 * que no se puede calcular. Combustible exige que la sucursal tenga UNA sola
 * subcategoría configurada: los medidores no registran subcategoría, así que con
 * dos o más no hay forma de saber qué factor corresponde.
 */
function impactoDe({ tipo, sucursal, sucursales, emissions, consumoTotal, unidad }) {
  const cfg = (sucursales || []).find((s) => s.nombre === sucursal);
  const sucId = cfg ? cfg.id : null;

  let key = null;
  let error = null;
  if (tipo === "combustible") {
    const subs = getSubcatsFor(sucursales, "combustible", sucursal);
    if (!subs.length) {
      error =
        "La sucursal no tiene una subcategoría de combustible configurada. Configúrala en Configuración → sucursal para habilitar el cálculo.";
    } else if (subs.length > 1) {
      error =
        "La sucursal tiene varias subcategorías de combustible configuradas (" +
        subs.map((s) => s.label).join(", ") +
        "), por lo que no es posible asignar un factor de emisión único al consumo de los medidores.";
    } else {
      key = subs[0].id;
    }
  } else {
    key = tipo;
  }

  const def = !error ? emissions.factoresEmpresa[key] || null : null;
  const valor = !error ? factorFor(emissions, sucId, key) : null;
  if (!error && tipo === "electricidad" && sucId != null && sucursalesSinFactor(sucursales).includes(sucId)) {
    error =
      "La sucursal reporta electricidad en un sistema eléctrico distinto del SEN y no tiene factor de emisión configurado.";
  }
  if (!error && valor == null) {
    error = "No hay factor de emisión configurado para este consumo. Configúralo en Impacto → Factores de emisión.";
  }

  const scope = def ? def.scope : tipo === "electricidad" ? 2 : tipo === "agua" ? 3 : 1;
  const scopeMeta = SCOPES[scope] || { label: "Alcance " + scope, desc: "" };
  const scopeChip = `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;background:#E6F4FB;color:#0069A6;">${esc(scopeMeta.label)}${scopeMeta.desc ? " · " + esc(scopeMeta.desc) : ""}</span>`;

  if (error) {
    return `<div style="background:#FFFAEB;border:1px solid #FEDF89;border-radius:8px;padding:12px 14px;font-size:11.5px;color:#B54708;"><strong>No fue posible calcular las emisiones.</strong> ${esc(error)}</div>`;
  }

  const kg = consumoTotal * valor;
  const propio = esFactorPropio(emissions, sucId, key);
  const unidadFactor = def ? def.unit : "kgCO₂e/" + unidad;
  const th = (label, align) =>
    `<th style="text-align:${align};padding:5px 8px;font-size:9.5px;font-weight:600;color:#727272;border-bottom:1px solid #E4E7EC;">${label}</th>`;

  return `<div style="display:flex;gap:10px;align-items:stretch;">
      <div style="flex:1.2;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:15px 16px;">
        <div style="font-size:11px;font-weight:600;color:#166534;">Emisiones GEI del periodo</div>
        <div style="font:700 25px/1.1 var(--rl-font-display);color:#14532D;margin-top:8px;">${fmtNum(kg)}<span style="font-size:13px;font-weight:600;margin-left:5px;">kgCO₂e</span></div>
        <div style="margin-top:8px;">${scopeChip}</div>
      </div>
      <div style="flex:2;border:1px solid #E4E7EC;border-radius:10px;padding:13px 16px;">
        <div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#919599;font-weight:700;margin-bottom:8px;">Factor de emisión aplicado</div>
        <table style="font-size:10.5px;"><thead><tr>
          ${th("Factor", "left")}${th("Valor", "right")}${th("Alcance", "center")}${th("Fuente", "left")}${th("Origen", "left")}
        </tr></thead><tbody><tr>
          <td style="text-align:left;padding:7px 8px;font-weight:700;color:#101828;">${esc(def ? def.label : key)}</td>
          <td style="text-align:right;padding:7px 8px;font-weight:600;color:#101828;">${coma(valor)} ${esc(unidadFactor)}</td>
          <td style="text-align:center;padding:7px 8px;color:#344054;">${esc(scopeMeta.label)}</td>
          <td style="text-align:left;padding:7px 8px;color:#667085;">${esc(def && def.fuente ? def.fuente : "—")}</td>
          <td style="text-align:left;padding:7px 8px;color:#667085;">${propio ? "Personalizado sucursal" : "Empresa"}</td>
        </tr></tbody></table>
        <div style="font-size:10px;color:#919599;margin-top:8px;">Cálculo: ${fmtNum(consumoTotal)} ${esc(unidad)} × ${coma(valor)} ${esc(unidadFactor)} = ${fmtNum(kg)} kgCO₂e</div>
      </div>
    </div>`;
}

/**
 * @param M         módulo de medidores leído de la planilla
 * @param meterIds  ids seleccionados en la pantalla; vacío = todos los activos
 * @returns HTML completo del reporte
 */
export function medidoresReporteHtml({
  M,
  records,
  sucursales,
  emissions,
  sucursal,
  tipo,
  meterIds,
  period,
  anchor,
  now = new Date(),
}) {
  const activos = metersFor(M, sucursal, tipo);
  const meters = meterIds?.length ? activos.filter((m) => meterIds.includes(m.id)) : activos;
  const unidad = medUnit(tipo);
  const tipoLbl = MED_TYPES[tipo] ? MED_TYPES[tipo].label : tipo;
  const rep = periodToMonthKeys(period, anchor);
  const ultimo = rep[rep.length - 1];
  const perLbl = rep.length ? monthLabelShort(rep[0]) + " – " + monthLabelShort(ultimo) : "—";
  const { corta, larga } = fechas(now);

  // Datos por medidor y mes.
  const filas = meters.map((m, i) => ({
    m,
    color: medColorAt(i),
    celdas: rep.map((mk) => ({
      lect: meterReadingFor(M.readings, m.id, mk),
      cons: consumoFor(M.readings, m.id, mk),
      costo: costoFor(M.readings, M.prices, m, mk),
      pay: payStatus(M.docs, m.id, mk),
    })),
  }));

  const totCons = rep.map((mk, ci) => filas.reduce((a, f) => a + (f.celdas[ci].cons ?? 0), 0));
  // El costo total considera solo medidores facturables; el consumo físico suma todos.
  const totCosto = rep.map((mk, ci) =>
    filas.reduce((a, f) => a + (!medFacturable(f.m) ? 0 : f.celdas[ci].costo ?? 0), 0),
  );
  const hayCons = rep.map((mk, ci) => filas.some((f) => f.celdas[ci].cons != null));

  const consUlt = totCons[totCons.length - 1] || 0;
  const consPrev = totCons.length > 1 ? totCons[totCons.length - 2] : 0;
  const costoUlt = totCosto[totCosto.length - 1] || 0;
  const acumulado = totCosto.reduce((a, b) => a + b, 0);
  const consValidos = totCons.filter((v, i) => hayCons[i]);
  const promedio = consValidos.length ? consValidos.reduce((a, b) => a + b, 0) / consValidos.length : 0;
  const varPct = consPrev > 0 ? ((consUlt - consPrev) / consPrev) * 100 : null;
  const boletaTotal = rep.reduce((a, mk) => a + (boletaFor(records, sucursal, tipo, mk) ?? 0), 0);
  const dif = boletaTotal > 0 ? acumulado - boletaTotal : null;
  const difPct = dif != null && boletaTotal > 0 ? (dif / boletaTotal) * 100 : null;

  // ----- Gráfico de consumo -----
  const W = 720;
  const H = 250;
  const padL = 60;
  const padR = 30;
  const padT = 18;
  const padB = 38;
  const n = rep.length;
  const valores = filas.flatMap((f) => f.celdas.map((c) => c.cons)).filter((v) => v != null);
  const top = valores.length && Math.max(...valores) > 0 ? Math.max(...valores) * 1.15 : 10;
  const X = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
  const Y = (v) => padT + (1 - v / top) * (H - padT - padB);

  const chartLines = filas
    .map((f) => {
      const pts = f.celdas.map((c, i) => (c.cons == null ? null : [X(i), Y(c.cons)])).filter(Boolean);
      if (!pts.length) return "";
      const dots = pts
        .map(
          (p) =>
            `<circle cx="${p[0]}" cy="${p[1].toFixed(1)}" r="3.5" fill="#fff" stroke="${f.color}" stroke-width="2"></circle>`,
        )
        .join("");
      return `<path d="${smoothPath(pts)}" fill="none" stroke="${f.color}" stroke-width="2.5" stroke-linecap="round"></path>${dots}`;
    })
    .join("");

  const gridSvg = [0, 0.25, 0.5, 0.75, 1]
    .map((g) => {
      const gy = padT + g * (H - padT - padB);
      return `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="${g === 1 ? "#E4E7EC" : "#F2F4F7"}"></line><text x="${padL - 8}" y="${gy + 3}" text-anchor="end" font-size="10" fill="#919599">${fmtNum(top * (1 - g))}</text>`;
    })
    .join("");

  const xSvg = rep
    .map(
      (mk, i) =>
        `<text x="${X(i)}" y="${H - 12}" text-anchor="middle" font-size="11" font-weight="600" fill="#475467">${monthLabelShort(mk)}</text>`,
    )
    .join("");

  const legend = filas
    .map(
      (f) =>
        `<span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:16px;height:3px;border-radius:2px;background:${f.color};display:inline-block;"></span>${esc(f.m.nombre)}${f.m.numero ? " · N° " + esc(f.m.numero) : ""}</span>`,
    )
    .join("");

  // ----- Detalle: 3 columnas por mes no cabe en A4 más allá de 3 meses, así que
  // el detalle se parte en bloques y se apila una tabla por bloque. -----
  const repIdx = rep.map((mk, ci) => ({ mk, ci }));
  const bloques = (tam) => {
    const out = [];
    for (let i = 0; i < repIdx.length; i += tam) out.push(repIdx.slice(i, i + tam));
    return out;
  };

  const thMes = (label) =>
    `<th colspan="3" style="text-align:center;padding:6px 8px;font-size:10.5px;font-weight:700;color:#0069A6;background:#E6F4FB;border-left:1px solid #E4E7EC;">${label}</th>`;
  const subTh = () =>
    `<th style="text-align:right;padding:6px 8px;font-size:9.5px;font-weight:600;color:#727272;border-bottom:2px solid #0069A6;border-left:1px solid #E4E7EC;">Lectura</th><th style="text-align:right;padding:6px 8px;font-size:9.5px;font-weight:600;color:#727272;border-bottom:2px solid #0069A6;">Consumo</th><th style="text-align:right;padding:6px 8px;font-size:9.5px;font-weight:600;color:#727272;border-bottom:2px solid #0069A6;">Costo</th>`;

  const detTable = (chunk) => {
    const body = filas
      .map(
        (f) => `<tr>
    <td style="text-align:left;padding:9px 10px;border-bottom:1px solid #EEE;"><span style="font-weight:700;color:#101828;">${esc(f.m.nombre)}</span>${f.m.numero ? ` <span style="color:#919599;">· N° ${esc(f.m.numero)}</span>` : ""}</td>
    ${chunk
      .map(({ ci }) => f.celdas[ci])
      .map(
        (c) =>
          `<td style="text-align:right;padding:9px 8px;border-bottom:1px solid #EEE;color:#667085;border-left:1px solid #E4E7EC;">${num(c.lect)}</td><td style="text-align:right;padding:9px 8px;border-bottom:1px solid #EEE;font-weight:600;color:#101828;">${num(c.cons)}</td><td style="text-align:right;padding:9px 8px;border-bottom:1px solid #EEE;color:#344054;">${money(c.costo)}</td>`,
      )
      .join("")}
  </tr>`,
      )
      .join("");

    const tot = `<tr style="background:#F9FAFB;"><td style="text-align:left;padding:10px;font-weight:700;color:#101828;border-top:2px solid #0069A6;">Totales</td>${chunk
      .map(
        ({ ci }) =>
          `<td style="text-align:right;padding:10px 8px;color:#919599;border-top:2px solid #0069A6;border-left:1px solid #E4E7EC;">—</td><td style="text-align:right;padding:10px 8px;font-weight:700;color:#0069A6;border-top:2px solid #0069A6;">${hayCons[ci] ? fmtNum(totCons[ci]) : "—"}</td><td style="text-align:right;padding:10px 8px;font-weight:700;color:#101828;border-top:2px solid #0069A6;">${fmtCLP(totCosto[ci])}</td>`,
      )
      .join("")}</tr>`;

    return `<table style="font-size:10.5px;"><thead>
      <tr><th rowspan="2" style="text-align:left;vertical-align:bottom;padding:8px 10px;font-size:11px;font-weight:700;color:#344054;border-bottom:2px solid #0069A6;">Medidor</th>${chunk.map(({ mk }) => thMes(monthLabelShort(mk))).join("")}</tr>
      <tr>${chunk.map(() => subTh()).join("")}</tr>
    </thead><tbody>${body}${tot}</tbody></table>`;
  };

  const payTable = (chunk) => {
    const head = chunk
      .map(
        ({ mk }) =>
          `<th style="text-align:center;padding:8px;font-size:10.5px;font-weight:700;color:#344054;border-bottom:1px solid #E4E7EC;">${monthLabelShort(mk)}</th>`,
      )
      .join("");
    const body = filas
      .map(
        (f) =>
          `<tr><td style="text-align:left;padding:9px 10px;border-bottom:1px solid #EEE;font-weight:700;color:#101828;">${esc(f.m.nombre)}${f.m.numero ? ` <span style="color:#919599;font-weight:400;">· N° ${esc(f.m.numero)}</span>` : ""}</td>${
            !medFacturable(f.m)
              ? `<td colspan="${chunk.length}" style="text-align:center;padding:9px 8px;border-bottom:1px solid #EEE;color:#B54708;font-weight:600;">Configurado para no ser facturado</td>`
              : chunk
                  .map(({ ci }) => f.celdas[ci])
                  .map(
                    (c) =>
                      `<td style="text-align:center;padding:9px 8px;border-bottom:1px solid #EEE;">${payChip(c.pay)}</td>`,
                  )
                  .join("")
          }</tr>`,
      )
      .join("");
    return `<table style="font-size:10.5px;"><thead><tr><th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;color:#344054;border-bottom:1px solid #E4E7EC;">Medidor</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };

  const separador = `<div style="height:12px;"></div>`;
  const detTables = bloques(3).map(detTable).join(separador);
  const payTables = bloques(6).map(payTable).join(separador);

  const impBlock = impactoDe({
    tipo,
    sucursal,
    sucursales,
    emissions,
    consumoTotal: totCons.reduce((a, b) => a + b, 0),
    unidad,
  });

  const difChip =
    dif == null
      ? `<span style="font-size:13px;font-weight:700;color:#919599;">Sin boleta registrada</span>`
      : `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700;background:${dif < 0 ? "#FEF3F2" : "#ECFDF3"};color:${dif < 0 ? "#B42318" : "#027A48"};">${dif > 0 ? "+" : ""}${fmtCLP(dif)}${difPct != null ? " · " + pct(difPct) : ""}</span>`;

  const kpi = (label, valor, sub) =>
    `<div style="flex:1;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:15px 16px;"><div style="font-size:11px;font-weight:600;color:#727272;">${label}</div><div style="font:700 21px/1.1 var(--rl-font-display);color:#101828;margin-top:9px;">${valor}</div><div style="font-size:11px;color:#919599;margin-top:6px;">${sub}</div></div>`;

  const meta = [
    ["Tipo de consumo", esc(tipoLbl)],
    ["Periodo del reporte", perLbl],
    ["Medidores", meters.length + " seleccionado" + (meters.length === 1 ? "" : "s")],
    ["Fecha de generación", corta],
  ];

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Estado de medidores · ${esc(sucursal)}</title>
<style>
  :root{--rl-font-display:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;--rl-font-body:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
  *{box-sizing:border-box;} body{margin:0;background:#ece8dd;font-family:var(--rl-font-body);color:#313334;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page{width:794px;min-height:1123px;max-width:100%;margin:20px auto;background:#fff;border-radius:6px;padding:30px 34px;box-shadow:0 8px 40px rgba(0,0,0,.12);}
  h1{font:700 24px/30px var(--rl-font-display);letter-spacing:-.02em;color:#101828;margin:0;}
  .btnbar{width:794px;max-width:100%;margin:16px auto 0;display:flex;gap:8px;justify-content:flex-end;}
  .btnbar button{font:600 13px var(--rl-font-display);border:none;border-radius:8px;padding:9px 16px;cursor:pointer;background:#0069A6;color:#fff;}
  .btnbar button.ghost{background:#fff;color:#0069A6;border:1px solid #0069A6;}
  .btnbar button[disabled]{opacity:.5;cursor:default;}
  table{width:100%;border-collapse:collapse;}
  @page{size:A4 portrait;margin:0;}
  @media print{ body{background:#fff;} .page{box-shadow:none;margin:0;width:210mm;min-height:auto;border-radius:0;} .noprint{display:none!important;} }
</style></head><body>
<div class="btnbar noprint"><button class="ghost" onclick="window.print()">Imprimir</button><button id="dlbtn" disabled onclick="dlPDF()">Cargando…</button></div>
<div class="page">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px;">
    <div><h1>Estado de medidores</h1></div>
    <div style="display:inline-flex;align-items:center;gap:8px;background:#E6F4FB;color:#0069A6;border-radius:999px;padding:8px 16px;font-weight:700;font-size:13px;white-space:nowrap;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICON[tipo] || ""}</svg>${esc(tipoLbl)}
    </div>
  </div>
  <div style="display:flex;margin-top:12px;border:1px solid #E4E7EC;border-radius:10px;overflow:hidden;background:#F9FAFB;">
    ${meta
      .map(
        (c, i) =>
          `${i ? '<div style="width:1px;background:#E4E7EC;"></div>' : ""}<div style="flex:1;padding:12px 16px;"><div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#919599;font-weight:700;">${c[0]}</div><div style="font-size:13px;font-weight:600;color:#101828;margin-top:3px;">${c[1]}</div></div>`,
      )
      .join("")}
  </div>
  <div style="display:flex;gap:10px;margin-top:14px;">
    <div style="flex:1.3;background:#0069A6;color:#fff;border-radius:10px;padding:15px 16px;"><div style="font-size:11px;font-weight:600;color:rgba(255,255,255,.82);">Consumo último mes</div><div style="font:700 27px/1.1 var(--rl-font-display);margin-top:9px;">${fmtNum(consUlt)}<span style="font-size:14px;font-weight:600;margin-left:4px;">${unidad}</span></div><div style="font-size:11px;color:rgba(255,255,255,.82);margin-top:6px;">${ultimo ? monthLabelShort(ultimo) : "—"}</div></div>
    ${kpi("Costo último mes", fmtCLP(costoUlt), ultimo ? monthLabelShort(ultimo) : "—")}
    ${kpi("Promedio mensual", `${fmtNum(promedio)}<span style="font-size:12px;font-weight:600;margin-left:3px;">${unidad}</span>`, "Consumo · " + perLbl)}
    ${kpi("Costo acumulado", fmtCLP(acumulado), "Total del periodo")}
    <div style="flex:1;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:15px 16px;"><div style="font-size:11px;font-weight:600;color:#727272;">Variación vs mes ant.</div><div style="font:700 21px/1.1 var(--rl-font-display);color:${varPct == null ? "#919599" : varPct > 0 ? "#B54708" : "#027A48"};margin-top:9px;">${varPct == null ? "—" : pct(varPct)}</div><div style="font-size:11px;color:#919599;margin-top:6px;">Consumo mensual</div></div>
  </div>
  <div style="margin-top:16px;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:16px 20px;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div style="font:600 15px/1.3 var(--rl-font-display);color:#101828;">Consumo mensual por medidor <span style="font-weight:500;color:#919599;">(${unidad})</span></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:11.5px;font-weight:600;color:#475467;">${legend}</div>
    </div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin-top:10px;overflow:visible;">${gridSvg}${xSvg}${chartLines}</svg>
  </div>
  <div style="margin-top:16px;">
    <div style="font:600 15px/1.3 var(--rl-font-display);color:#101828;margin-bottom:9px;">Detalle por medidor</div>
    ${detTables}
    <div style="font-size:10px;color:#919599;margin-top:8px;">Lectura y consumo en ${unidad} · Costos en pesos chilenos (CLP).</div>
  </div>
  <div style="margin-top:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px;">
      <div style="font:600 15px/1.3 var(--rl-font-display);color:#101828;">Diferencia contra boletas registradas</div>
      ${difChip}
    </div>
    <div style="font-size:10.5px;color:#667085;">Suma de costos calculados de los medidores facturables (${fmtCLP(acumulado)}) contra el costo de las boletas registradas en el sistema${boletaTotal > 0 ? ` (${fmtCLP(boletaTotal)})` : ""}.</div>
  </div>
  <div style="margin-top:16px;">
    <div style="font:600 15px/1.3 var(--rl-font-display);color:#101828;margin-bottom:9px;">Estado de pagos</div>
    ${payTables}
  </div>
  <div style="margin-top:16px;">
    <div style="font:600 15px/1.3 var(--rl-font-display);color:#101828;margin-bottom:9px;">Impacto ambiental</div>
    ${impBlock}
    <div style="background:#F9FAFB;border:1px solid #E4E7EC;border-radius:8px;padding:10px 14px;margin-top:10px;font-size:10.5px;line-height:1.55;color:#475467;">
      <strong style="color:#344054;">¿Qué significa kgCO₂e?</strong> Los kilogramos de dióxido de carbono equivalente (kgCO₂e) son la unidad estándar para medir la huella de carbono: expresa el efecto de todos los gases de efecto invernadero (CO₂, CH₄, N₂O, entre otros) como la cantidad de CO₂ que produciría el mismo calentamiento global. Esto permite sumar y comparar emisiones de distintas fuentes en una sola cifra. El alcance indica dónde se generan: Alcance 1 son emisiones directas (ej. combustión propia), Alcance 2 la energía comprada (ej. electricidad) y Alcance 3 otras emisiones indirectas de la cadena de valor (ej. agua potable).
    </div>
  </div>
  <div style="border-top:1px solid #E4E7EC;padding-top:8px;margin-top:14px;display:flex;justify-content:space-between;font-size:10px;color:#919599;"><span>Documento generado automáticamente por Recylink</span><span>Generado el ${larga}</span></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
<script>
  var _btn = document.getElementById('dlbtn');
  function _ready(){ return window.html2canvas && window.jspdf && window.jspdf.jsPDF; }
  (function wait(){ if(_ready()){ _btn.disabled=false; _btn.textContent='Descargar PDF'; } else setTimeout(wait,150); })();
  function dlPDF(){
    if(!_ready()){ alert('Aún cargando la librería, reintenta en un segundo.'); return; }
    var el=document.querySelector('.page');
    _btn.disabled=true; _btn.textContent='Generando…';
    html2canvas(el,{scale:2,backgroundColor:'#ffffff'}).then(function(canvas){
      var pdf=new window.jspdf.jsPDF('p','mm','a4');
      var pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight();
      var iw=pw, ih=canvas.height*pw/canvas.width, x=0, y=0;
      if(ih>ph){ ih=ph; iw=canvas.width*ph/canvas.height; x=(pw-iw)/2; }
      pdf.addImage(canvas.toDataURL('image/jpeg',0.95),'JPEG',x,y,iw,ih);
      pdf.save('Estado-de-medidores.pdf');
      _btn.disabled=false; _btn.textContent='Descargar PDF';
    }).catch(function(e){ alert('Error generando PDF: '+e); _btn.disabled=false; _btn.textContent='Descargar PDF'; });
  }
</script>
</body></html>`;
}
