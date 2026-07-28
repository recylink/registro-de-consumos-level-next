"use client";

// Impacto ambiental: huella de emisiones GEI. Portado de proto/impacto.jsx.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, Chip, SectionHead } from "@/components/ui/layout";
import { FiltrosSucursalPeriodo } from "@/components/ui/filtros";
import { AreaEmisiones } from "@/components/charts/area-emisiones";
import { fmtTon } from "@/lib/domain/format";
import { periodLabel, periodToMonthKeys } from "@/lib/domain/periods";
import { SCOPES } from "@/lib/domain/emisiones";
import {
  CAT_META, SCOPE_COLORS, agregadoEmisiones, emisionesDelAnio, emisionesPorMes,
  emisionesPorSucursal, nombresSucursalesSinFactor,
} from "@/lib/domain/emisiones-calc";

const FILTROS_INICIALES = { sucursal: "all", period: "12m" };

const ICONO_ALCANCE = { 1: "local_gas_station", 2: "bolt", 3: "water_drop" };

function BarrasPorSucursal({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.tco2e));
  const orden = [...rows].sort((a, b) => b.tco2e - a.tco2e);
  return (
    <div className="prt-stack-sm">
      {orden.map((r) => (
        <div key={r.id} className="emis-bar-row" style={{ opacity: r.activa ? 1 : 0.6 }}>
          <div className="emis-bar-label">
            <span style={{ fontWeight: 600, color: "var(--rl-gray-800)" }}>{r.nombre}</span>
            {!r.activa && <Chip size="sm">Inactiva</Chip>}
            {r.sinFactor && (
              <Chip kind="warning" size="sm" icon="warning">Sin factor</Chip>
            )}
          </div>
          <div className="emis-bar-track">
            <span
              className="emis-bar-fill"
              style={{
                width: (r.tco2e / max) * 100 + "%",
                background: r.sinFactor
                  ? "var(--rl-warning-300)"
                  : r.activa
                    ? "var(--rl-primary-900)"
                    : "var(--rl-gray-300)",
              }}
            />
          </div>
          <div className="emis-bar-value">
            {r.sinFactor && r.tco2e === 0 ? "—" : fmtTon(r.tco2e)}{" "}
            <span className="prt-hint" style={{ fontSize: 11 }}>tCO₂e</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutCategorias({ byCat, total }) {
  const cats = Object.keys(CAT_META).filter((k) => byCat[k] > 0);
  const r = 62;
  const c = 2 * Math.PI * r;
  let acc = 0;

  if (total <= 0) {
    return <div className="prt-hint">Sin emisiones en el período seleccionado.</div>;
  }

  return (
    <div className="prt-row" style={{ gap: 24, alignItems: "center" }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--rl-gray-100)" strokeWidth="20" />
        {cats.map((k) => {
          const dash = (byCat[k] / total) * c;
          const el = (
            <circle
              key={k}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={CAT_META[k].color}
              strokeWidth="20"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-acc}
              transform="rotate(-90 80 80)"
            />
          );
          acc += dash;
          return el;
        })}
        <text x="80" y="74" textAnchor="middle" fontSize="22" fontWeight="700" fontFamily="var(--rl-font-display)" fill="var(--rl-gray-900)">
          {fmtTon(total, 0)}
        </text>
        <text x="80" y="92" textAnchor="middle" fontSize="10" fontFamily="var(--rl-font-display)" fill="var(--rl-gray-500)" letterSpacing="0.08em">
          tCO₂e TOTAL
        </text>
      </svg>
      <div className="prt-stack-sm" style={{ flex: 1 }}>
        {cats.map((k) => (
          <div key={k} className="prt-spread" style={{ gap: 10 }}>
            <span className="prt-row" style={{ gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: CAT_META[k].color }} />
              <span style={{ font: "600 13px/1 var(--rl-font-display)", color: "var(--rl-gray-800)" }}>
                {CAT_META[k].label}
              </span>
            </span>
            <span className="prt-row" style={{ gap: 8 }}>
              <strong style={{ font: "700 13px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>
                {fmtTon(byCat[k])}
              </strong>
              <span className="prt-hint" style={{ fontSize: 11, minWidth: 34, textAlign: "right" }}>
                {Math.round((byCat[k] / total) * 100)}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Barra anclada a la meta: el tope del eje ES la meta, así la marca queda al
 * borde derecho. Solo se estira si el valor real pasa el 92% de la meta, y en ese
 * caso el eje llega a real/0.9 para que el valor nunca toque el borde.
 *
 * modo "generacion": tope de tCO₂e — pasarse es malo, el exceso va en rojo.
 * modo "reduccion": % logrado — pasarse es bueno, el exceso va en azul.
 */
function BarraMeta({ modo, label, real, meta, fmt, unit }) {
  const ejeMax = meta > 0 ? (real > meta * 0.92 ? real / 0.9 : meta) : real > 0 ? real / 0.9 : 1;
  const pct = (v) => Math.max(0, Math.min(100, (v / ejeMax) * 100));
  const metaPct = pct(meta);
  const aumento = modo === "reduccion" && real < 0;

  const tramos = [];
  if (modo === "generacion" && real > 0) {
    const verde = Math.min(real, meta);
    if (verde > 0) tramos.push([0, verde, "var(--rl-success-500)"]);
    if (real > meta) tramos.push([meta, real, "var(--rl-error-500)"]);
  } else if (modo === "reduccion" && real > 0) {
    if (real < meta) tramos.push([0, real, "var(--rl-error-500)"]);
    else {
      tramos.push([0, meta, "var(--rl-success-500)"]);
      if (real > meta) tramos.push([meta, real, "var(--rl-primary-800)"]);
    }
  }

  const colorValor =
    aumento || (modo === "generacion" && real > meta) ? "var(--rl-error-600)" : "var(--rl-gray-900)";
  const u = unit ? " " + unit : "";
  const trackMalo = modo === "reduccion" && real < meta;

  return (
    <div>
      <div className="prt-spread" style={{ marginBottom: 6 }}>
        <span className="emis-goal-label">{label}</span>
        <span style={{ font: "700 12px/1 var(--rl-font-display)", color: colorValor }}>
          {fmt(real)}
          <span style={{ color: "var(--rl-gray-400)", fontWeight: 600 }}>
            {" / "}
            {fmt(meta)}
            {u}
          </span>
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <div
          className="emis-goal-track"
          style={{ overflow: "hidden", ...(trackMalo ? { background: "var(--rl-error-50)" } : {}) }}
        >
          {tramos.map((t, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: pct(t[0]) + "%",
                width: Math.max(0, pct(t[1]) - pct(t[0])) + "%",
                background: t[2],
              }}
            />
          ))}
        </div>
        <span className="emis-goal-marker" style={{ left: metaPct + "%" }} title="Meta" />
      </div>
      <div style={{ position: "relative", height: 13, marginTop: 4 }}>
        <span
          className="emis-goal-meta-label"
          style={metaPct > 65 ? { right: 100 - metaPct + "%" } : { left: metaPct + "%", transform: "translateX(-50%)" }}
        >
          Meta {fmt(meta)}
          {u}
        </span>
      </div>
      {aumento && (
        <div className="emis-goal-aumento">
          <Icon name="trending_up" size={13} /> aumento de {fmt(Math.abs(real))} vs año base
        </div>
      )}
    </div>
  );
}

function ProgresoMeta({ actual, metaAbsoluta, metaRelativa, anioBase, valorBase }) {
  const hayAbs = metaAbsoluta > 0;
  const hayRel = metaRelativa > 0;
  const reduccion = valorBase > 0 ? ((valorBase - actual) / valorBase) * 100 : null;

  if (!hayAbs && !hayRel) {
    return (
      <div style={{ textAlign: "center", padding: "14px 10px" }}>
        <span
          className="prt-kpi-ico"
          style={{ width: 44, height: 44, margin: "0 auto 10px", background: "var(--rl-gray-100)", color: "var(--rl-gray-500)" }}
        >
          <Icon name="target" size={22} />
        </span>
        <div style={{ font: "600 14px/1.3 var(--rl-font-display)", color: "var(--rl-gray-800)", marginBottom: 6 }}>
          Sin meta definida
        </div>
        <div className="prt-hint" style={{ lineHeight: 1.5 }}>
          Define una meta absoluta (tope de tCO₂e) o relativa (% de reducción) para seguir el progreso.
        </div>
      </div>
    );
  }

  let chip;
  if (hayRel && reduccion != null) {
    chip =
      reduccion >= metaRelativa
        ? { kind: "success", icon: "check", label: "Meta cumplida" }
        : reduccion > 0
          ? { kind: "success", icon: "trending_down", label: "En progreso" }
          : { kind: "error", icon: "trending_up", label: "Aumento vs año base" };
  } else if (hayAbs) {
    chip =
      actual <= metaAbsoluta
        ? { kind: "success", icon: "check", label: "Bajo el tope" }
        : { kind: "error", icon: "warning", label: "Tope excedido" };
  } else {
    chip = { kind: "warning", icon: "warning", label: "Falta año base" };
  }

  const metaAnual = hayAbs ? metaAbsoluta : valorBase > 0 ? valorBase * (1 - metaRelativa / 100) : null;

  return (
    <div>
      <div className="prt-spread" style={{ alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          {hayRel && reduccion != null ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span
                  style={{
                    font: "700 28px/1 var(--rl-font-display)",
                    color: reduccion < 0 ? "var(--rl-error-600)" : "var(--rl-success-700)",
                  }}
                >
                  {fmtTon(reduccion, 1)}%
                </span>
                <span style={{ font: "600 15px/1 var(--rl-font-display)", color: "var(--rl-gray-400)" }}>/</span>
                <span style={{ font: "700 15px/1 var(--rl-font-display)", color: "var(--rl-gray-500)" }}>
                  {fmtTon(metaRelativa, 1)}%
                </span>
              </div>
              <div className="prt-hint" style={{ marginTop: 5 }}>
                logrado vs meta · año base {anioBase}
              </div>
            </>
          ) : (
            <>
              <span style={{ font: "700 28px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>
                {fmtTon(actual, 0)}
              </span>
              <div className="prt-hint" style={{ marginTop: 5 }}>tCO₂e/año actual (anualizado)</div>
            </>
          )}
        </div>
        <Chip kind={chip.kind} size="sm" icon={chip.icon}>{chip.label}</Chip>
      </div>

      {hayAbs && hayRel && (
        <div className="emis-goal-nota">
          <span style={{ color: "var(--rl-gray-400)", flexShrink: 0, marginTop: 1 }}>
            <Icon name="info" size={14} />
          </span>
          <span className="prt-hint" style={{ fontSize: 11, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--rl-gray-600)" }}>Tope de emisiones</strong> mide el total
            absoluto del año (ej: 4 de 10 tCO₂e permitidas);{" "}
            <strong style={{ color: "var(--rl-gray-600)" }}>Reducción vs año base</strong> compara
            contra lo que emitías en {anioBase}. Puedes estar dentro del tope y aun así haber
            aumentado vs el año base.
          </span>
        </div>
      )}

      <div className="prt-stack-sm" style={{ gap: 14 }}>
        {hayAbs && (
          <BarraMeta
            modo="generacion"
            label="Tope de emisiones"
            real={actual}
            meta={metaAbsoluta}
            fmt={(v) => fmtTon(v, 0)}
            unit="tCO₂e"
          />
        )}
        {hayRel &&
          (reduccion != null ? (
            <BarraMeta
              modo="reduccion"
              label="Reducción vs año base"
              real={reduccion}
              meta={metaRelativa}
              fmt={(v) => fmtTon(v, 1) + "%"}
              unit=""
            />
          ) : (
            <div className="prt-hint" style={{ lineHeight: 1.5 }}>
              Define las emisiones del año base {anioBase} en Metas para medir la reducción lograda.
            </div>
          ))}
      </div>

      <div className="emis-goal-cifras">
        {[
          { label: "Actual (anualizado)", value: actual },
          { label: `Año base ${anioBase}`, value: valorBase > 0 ? valorBase : null },
          { label: "Meta anual", value: metaAnual },
        ].map((s) => (
          <div key={s.label}>
            <div className="prt-hint" style={{ fontSize: 10.5, marginBottom: 3 }}>{s.label}</div>
            <div style={{ font: "700 14px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>
              {fmtTon(s.value, 0)}{" "}
              <span style={{ font: "500 10.5px/1 var(--rl-font-body)", color: "var(--rl-gray-500)" }}>
                tCO₂e
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Impacto({ records, sucursales, emissions, mesActual }) {
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [alcance, setAlcance] = useState("all");

  const ctx = useMemo(
    () => ({ records, sucursales, emissions, anchor: mesActual }),
    [records, sucursales, emissions, mesActual],
  );

  const agg = useMemo(() => agregadoEmisiones(ctx, filtros), [ctx, filtros]);
  const serie = useMemo(() => emisionesPorMes(ctx, alcance, filtros), [ctx, alcance, filtros]);
  const porSucursal = useMemo(() => emisionesPorSucursal(ctx, alcance, filtros), [ctx, alcance, filtros]);
  const sinFactor = useMemo(() => nombresSucursalesSinFactor(sucursales), [sucursales]);

  const periodoLbl = periodLabel(filtros.period, mesActual);

  // La meta puede ser de la sucursal filtrada o de la empresa. Una sucursal que
  // hereda la meta de empresa no tiene emisiones de año base propias, así que no
  // hay comparación posible.
  const sucSel = filtros.sucursal !== "all" ? sucursales.find((s) => s.nombre === filtros.sucursal) : null;
  const meta = sucSel ? emissions.metas.sucursales[sucSel.id] : emissions.metas.empresa;

  // El período filtrado se anualiza para comparar contra base y meta, que son
  // valores anuales.
  const nMeses = Math.max(1, periodToMonthKeys(filtros.period, mesActual).length);
  const anualizado = (agg.total / nMeses) * 12;

  const valorBase = !meta
    ? 0
    : meta.baseMode === "auto"
      ? emisionesDelAnio(ctx, meta.anioBase, sucSel?.nombre)
      : parseFloat(meta.baseEmissions) || 0;

  const colorLinea = alcance === "all" ? "var(--rl-success-600)" : SCOPE_COLORS[alcance].stroke;

  return (
    <div>
      <SectionHead
        eyebrow="Impacto Ambiental"
        title="Emisiones de gases de efecto invernadero"
        sub="Huella de carbono operacional medida en toneladas de CO₂ equivalente (tCO₂e), según la guía Huella Chile."
        right={
          <>
            <Link className="prt-btn" href="/impacto/factores">
              <Icon name="tune" />
              Factores
            </Link>
            <Link className="prt-btn primary" href="/impacto/metas">
              <Icon name="target" />
              Metas
            </Link>
          </>
        }
      />

      <FiltrosSucursalPeriodo
        sucursal={filtros.sucursal}
        period={filtros.period}
        sucursales={sucursales}
        mesActual={mesActual}
        onChange={(k, v) => setFiltros((f) => ({ ...f, [k]: v }))}
        onReset={() => setFiltros(FILTROS_INICIALES)}
      />

      {sinFactor.length > 0 && (
        <div className="emis-alert" style={{ marginBottom: 18 }}>
          <span className="ico">
            <Icon name="warning" size={20} />
          </span>
          <div className="prt-grow">
            <div className="ttl">
              {sinFactor.length} sucursal{sinFactor.length > 1 ? "es" : ""} sin factor de emisión configurado
            </div>
            <div className="sub">
              {sinFactor.join(", ")} — sus consumos no se contabilizan en el total hasta definir el
              factor de su sistema eléctrico.
            </div>
          </div>
          <Link className="prt-btn primary sm" href="/impacto/factores">
            Configurar factores
            <Icon name="arrow_forward" />
          </Link>
        </div>
      )}

      <div className="rc-impacto-kpis">
        <div className="prt-kpi rc-kpi-total">
          <div className="prt-kpi-head">
            <span className="prt-kpi-label" style={{ color: "rgba(255,255,255,0.75)" }}>
              Total emisiones · {periodoLbl}
            </span>
            <span className="prt-kpi-ico" style={{ background: "rgba(255,255,255,0.15)", color: "#FFFFFF" }}>
              <Icon name="eco" size={22} />
            </span>
          </div>
          <div className="prt-kpi-value" style={{ color: "#FFFFFF" }}>
            <span>{fmtTon(agg.total)}</span>
            <span className="unit" style={{ color: "rgba(255,255,255,0.7)" }}>tCO₂e</span>
          </div>
          <span className="prt-hint" style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
            huella operacional del período seleccionado
          </span>
        </div>
        {[1, 2, 3].map((s) => {
          const v = agg.byScope[s];
          const pct = agg.total > 0 ? Math.round((v / agg.total) * 100) : 0;
          return (
            <div key={s} className="prt-kpi">
              <div className="prt-kpi-head">
                <span className="prt-kpi-label">{SCOPES[s].label}</span>
                <span className="prt-kpi-ico" style={{ background: SCOPES[s].bg, color: SCOPES[s].color }}>
                  <Icon name={ICONO_ALCANCE[s]} size={20} />
                </span>
              </div>
              <div className="prt-kpi-value">
                <span>{fmtTon(v)}</span>
                <span className="unit">tCO₂e</span>
              </div>
              <div className="prt-row" style={{ gap: 8 }}>
                <span className="prt-hint" style={{ fontSize: 11 }}>
                  {SCOPES[s].desc} · {pct}% del total
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rc-impacto-fila">
        <Card flush>
          <div className="prt-card-head">
            <div>
              <div className="prt-h3">Evolución de emisiones</div>
              <div className="prt-hint" style={{ marginTop: 2 }}>
                tCO₂e por mes · {periodoLbl.toLowerCase()}
              </div>
            </div>
            <div className="prt-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {[
                { id: "all", label: "Todos los alcances" },
                { id: "1", label: SCOPES[1].label },
                { id: "2", label: SCOPES[2].label },
                { id: "3", label: SCOPES[3].label },
              ].map((sc) => (
                <button
                  key={sc.id}
                  className={"prt-pill" + (alcance === sc.id ? " active" : "")}
                  onClick={() => setAlcance(sc.id)}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: "18px 22px 14px" }}>
            <AreaEmisiones months={serie.months} data={serie.data} color={colorLinea} />
          </div>
        </Card>

        <Card>
          <div className="prt-row" style={{ gap: 8, marginBottom: 16 }}>
            <span
              className="prt-kpi-ico"
              style={{ width: 36, height: 36, background: "var(--rl-success-50)", color: "var(--rl-success-700)" }}
            >
              <Icon name="target" size={18} />
            </span>
            <div>
              <div className="prt-h3">Progreso vs meta</div>
              <div className="prt-hint">
                {sucSel ? `Meta de ${sucSel.nombre}` : "Meta de reducción de empresa"}
              </div>
            </div>
          </div>
          <ProgresoMeta
            actual={anualizado}
            metaAbsoluta={meta ? parseFloat(meta.absoluta) || 0 : 0}
            metaRelativa={meta ? parseFloat(meta.relativa) || 0 : 0}
            anioBase={meta ? meta.anioBase : ""}
            valorBase={valorBase}
          />
          <div className="prt-divider" style={{ margin: "18px 0 14px" }} />
          <Link className="prt-btn sm" style={{ width: "100%" }} href="/impacto/metas">
            <Icon name="edit" size={15} /> Ajustar metas
          </Link>
        </Card>
      </div>

      <div className="rc-impacto-fila inversa">
        <Card>
          <div className="prt-h3" style={{ marginBottom: 4 }}>tCO₂e por tipo de consumo</div>
          <div className="prt-hint" style={{ marginBottom: 18 }}>Distribución de la huella total</div>
          <DonutCategorias byCat={agg.byCat} total={agg.total} />
        </Card>

        <Card flush>
          <div className="prt-card-head">
            <div>
              <div className="prt-h3">Comparativa entre sucursales</div>
              <div className="prt-hint" style={{ marginTop: 2 }}>
                {alcance === "all" ? "Todos los alcances" : SCOPES[alcance].label} · tCO₂e ·{" "}
                {periodoLbl.toLowerCase()}
              </div>
            </div>
            <Chip>{porSucursal.filter((s) => s.activa).length} activas</Chip>
          </div>
          <div className="prt-card-body">
            <BarrasPorSucursal rows={porSucursal} />
          </div>
        </Card>
      </div>
    </div>
  );
}
