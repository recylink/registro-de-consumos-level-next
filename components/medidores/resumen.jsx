"use client";

// Pestaña Resumen: selector múltiple de medidores, KPIs, gráfico de consumo y
// descarga del reporte. Portado de proto/medidores.jsx.
//
// El reporte ya no se arma en el navegador con document.write sobre una ventana
// nueva: es una ruta del servidor (/medidores/reporte) que se abre en otra
// pestaña. Antes de abrirla se fuerza el guardado pendiente, porque el reporte
// lee los datos de la planilla, no del estado local.

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Btn } from "@/components/ui/controls";
import { Card, EmptyState } from "@/components/ui/layout";
import { useMedidores } from "@/components/medidores/estado";
import { smoothPath } from "@/components/charts/smooth";
import { fmtCLP, fmtNum, monthLabelShort } from "@/lib/domain/format";
import { medColorAt, meterLabel } from "@/lib/domain/medidores";
import { consumoFor, costoFor, medUnit } from "@/lib/domain/medidores-calc";
import { periodLabel } from "@/lib/domain/periods";

/** Líneas suavizadas de consumo por medidor × mes. */
function MedResumenChart({ series, monthsView }) {
  const W = 720;
  const H = 280;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const n = monthsView.length;
  const valores = series.flatMap((s) => s.vals).filter((v) => v != null);
  const max = valores.length ? Math.max(...valores) : 0;
  const top = max > 0 ? max * 1.15 : 10;
  const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / top) * (H - padT - padB);
  const grid = [0, 0.25, 0.5, 0.75, 1];

  if (!series.length || !valores.length) {
    return (
      <div className="prt-muted" style={{ padding: "40px 0", textAlign: "center" }}>
        Sin consumo calculado para graficar. Carga lecturas en al menos dos meses.
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      {grid.map((g, i) => {
        const gy = padT + g * (H - padT - padB);
        return (
          <g key={g}>
            <line
              x1={padL}
              y1={gy}
              x2={W - padR}
              y2={gy}
              stroke={i === grid.length - 1 ? "var(--rl-gray-200)" : "var(--rl-gray-100)"}
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={gy + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--rl-gray-400)"
              fontFamily="var(--rl-font-body)"
            >
              {fmtNum(top * (1 - g))}
            </text>
          </g>
        );
      })}
      {monthsView.map((mk, i) => (
        <text
          key={mk}
          x={x(i)}
          y={H - 10}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fill="var(--rl-gray-600)"
          fontFamily="var(--rl-font-body)"
        >
          {monthLabelShort(mk)}
        </text>
      ))}
      {series.map((s) => {
        const pts = s.vals.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
        return (
          <g key={s.meter.id}>
            <path
              d={smoothPath(pts)}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2" />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Multi-select de medidores: el Select del proyecto es de una sola opción. */
function MedMeterPicker({ meters, selected, onToggle, onAll, onNone, colorOf }) {
  const [open, setOpen] = useState(false);
  const count = selected.size;

  return (
    <div className="rc-med-picker">
      <button className="rc-med-picker-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="speed" size={15} />
        <span className="rc-med-picker-txt">
          {count === 0 ? "Selecciona medidores" : count + " medidor" + (count === 1 ? "" : "es")}
        </span>
        <Icon name="expand_more" size={16} />
      </button>
      {open && (
        <>
          {/* Capa de cierre: click afuera cierra el menú sin listeners en document. */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="rc-med-picker-menu" role="listbox" style={{ zIndex: 41 }}>
            <div className="rc-med-picker-actions">
              <button onClick={onAll}>Todos</button>
              <button onClick={onNone}>Ninguno</button>
            </div>
            {meters.length === 0 && (
              <div className="prt-muted" style={{ padding: "8px 10px", fontSize: 13 }}>
                Sin medidores.
              </div>
            )}
            {meters.map((m) => {
              const on = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  role="option"
                  aria-selected={on}
                  className={"rc-med-picker-item" + (on ? " on" : "")}
                  onClick={() => onToggle(m.id)}
                >
                  <span className="chk">{on && <Icon name="check" size={13} />}</span>
                  <span className="dot" style={{ background: colorOf(m) }} />
                  <span className="lbl">{meterLabel(m)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function ResumenTab({ suc, type, meters, monthsView, period, mesActual }) {
  const { M, flush } = useMedidores();
  const unit = medUnit(type);
  // Selección vacía por defecto — el usuario elige en el desplegable.
  const [selected, setSelected] = useState(() => new Set());
  const [abriendo, setAbriendo] = useState(false);

  const alternar = (id) =>
    setSelected((s) => {
      const nx = new Set(s);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });

  const colorOf = (m) => medColorAt(meters.findIndex((x) => x.id === m.id));
  const elegidos = meters.filter((m) => selected.has(m.id));
  const series = elegidos.map((m) => ({
    meter: m,
    color: colorOf(m),
    vals: monthsView.map((mk) => consumoFor(M.readings, m.id, mk)),
  }));

  const ultimoMes = monthsView[monthsView.length - 1];
  const suma = (fn) => elegidos.reduce((acc, m) => acc + (fn(m) ?? 0), 0);
  const totalPeriodo = elegidos.reduce(
    (acc, m) => acc + monthsView.reduce((a, mk) => a + (consumoFor(M.readings, m.id, mk) ?? 0), 0),
    0,
  );
  const consumoUlt = suma((m) => consumoFor(M.readings, m.id, ultimoMes));
  const costoUlt = suma((m) => costoFor(M.readings, M.prices, m, ultimoMes));

  // El reporte se arma en el servidor: primero se escribe lo pendiente.
  const abrirReporte = async () => {
    setAbriendo(true);
    await flush();
    setAbriendo(false);
    const qs = new URLSearchParams({
      sucursal: suc,
      tipo: type,
      period,
      anchor: mesActual,
      medidores: elegidos.map((m) => m.id).join(","),
    });
    window.open("/medidores/reporte?" + qs.toString(), "_blank", "noopener");
  };

  return (
    <div className="rc-med-resumen">
      <div className="rc-med-resumen-bar">
        <MedMeterPicker
          meters={meters}
          selected={selected}
          onToggle={alternar}
          onAll={() => setSelected(new Set(meters.map((m) => m.id)))}
          onNone={() => setSelected(new Set())}
          colorOf={colorOf}
        />
        <Btn icon="file_download" disabled={!elegidos.length || abriendo} onClick={abrirReporte}>
          {abriendo ? "Preparando…" : "Descargar reporte"}
        </Btn>
      </div>

      {!elegidos.length ? (
        <EmptyState
          icon="dashboard"
          title="Selecciona medidores"
          body="Elige uno o más medidores en el desplegable para ver KPIs y el gráfico de consumo."
        />
      ) : (
        <>
          <div className="rc-med-kpis">
            <div className="rc-med-kpi primary">
              <div className="rc-med-kpi-label">Consumo total del período</div>
              <div className="rc-med-kpi-val">
                {fmtNum(totalPeriodo)}
                <span className="rc-med-kpi-unit">{unit}</span>
              </div>
              <div className="rc-med-kpi-sub">{periodLabel(period, mesActual)}</div>
            </div>
            <div className="rc-med-kpi">
              <div className="rc-med-kpi-label">Consumo último mes</div>
              <div className="rc-med-kpi-val">
                {fmtNum(consumoUlt)}
                <span className="rc-med-kpi-unit">{unit}</span>
              </div>
              <div className="rc-med-kpi-sub">{ultimoMes ? monthLabelShort(ultimoMes) : "—"}</div>
            </div>
            <div className="rc-med-kpi">
              <div className="rc-med-kpi-label">Costo último mes</div>
              <div className="rc-med-kpi-val">{fmtCLP(costoUlt)}</div>
              <div className="rc-med-kpi-sub">{ultimoMes ? monthLabelShort(ultimoMes) : "—"}</div>
            </div>
          </div>

          <Card>
            <div className="rc-med-chart-head">
              <div className="rc-med-chart-title">
                Consumo mensual por medidor <span>({unit})</span>
              </div>
              <div className="rc-med-chart-legend">
                {series.map((s) => (
                  <span key={s.meter.id} className="rc-med-legend-item">
                    <span className="rc-med-legend-line" style={{ background: s.color }} />
                    {meterLabel(s.meter)}
                  </span>
                ))}
              </div>
            </div>
            <MedResumenChart series={series} monthsView={monthsView} />
          </Card>
        </>
      )}
    </div>
  );
}
