"use client";

// Gráfico de líneas mensual, SVG a mano. Portado de proto/dashboard.jsx sin
// cambios de forma: curva suavizada, guía vertical al pasar el mouse, tooltip
// flotante y leyenda con totales.

import { useState } from "react";
import { fmtNum, monthLabelShort } from "@/lib/domain/format";

/**
 * Catmull-Rom convertido a Bézier cúbica. Con tensión 0.2 la curva es suave
 * pero no se pasa de los puntos (overshoot), que en una serie de consumos
 * dibujaría valores que no existen.
 */
function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const t = 0.2;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

const W = 620;
const PAD = { l: 44, r: 16, t: 18, b: 30 };
const TICKS = [0, 0.25, 0.5, 0.75, 1];

export function MultiLineChart({ months, series, unit, h = 220 }) {
  const [hover, setHover] = useState(null);

  const innerW = W - PAD.l - PAD.r;
  const innerH = h - PAD.t - PAD.b;
  const n = months.length;
  const yMax = Math.max(...series.flatMap((s) => s.data), 1);
  const sx = (i) => PAD.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const sy = (y) => PAD.t + (1 - y / yMax) * innerH;
  const colW = n > 1 ? innerW / (n - 1) : innerW;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${h}`} width="100%" style={{ display: "block", overflow: "visible" }}>
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + t * innerH}
            y2={PAD.t + t * innerH}
            stroke="var(--rl-gray-200)"
            strokeWidth="1"
            strokeDasharray={i === TICKS.length - 1 ? "0" : "2 4"}
          />
        ))}
        {TICKS.map((t, i) => (
          <text
            key={i}
            x={PAD.l - 8}
            y={sy(yMax * t) + 3}
            textAnchor="end"
            fontSize="10"
            fontFamily="var(--rl-font-display)"
            fill="var(--rl-gray-500)"
          >
            {Math.round(yMax * t).toLocaleString("es-CL")}
          </text>
        ))}
        <text
          x={PAD.l - 8}
          y={PAD.t - 6}
          textAnchor="end"
          fontSize="10"
          fontFamily="var(--rl-font-display)"
          fill="var(--rl-gray-500)"
          fontWeight="700"
        >
          {unit}
        </text>

        {/* Con más de 6 meses se saltean etiquetas para que no se pisen. */}
        {months.map((mk, i) =>
          n > 6 && i % Math.ceil(n / 6) !== 0 ? null : (
            <text
              key={i}
              x={sx(i)}
              y={h - 10}
              textAnchor="middle"
              fontSize="10"
              fontFamily="var(--rl-font-display)"
              fill="var(--rl-gray-500)"
            >
              {monthLabelShort(mk)}
            </text>
          ),
        )}

        {series.map((s, si) => (
          <g key={si}>
            <path
              d={smoothPath(s.data.map((y, i) => [sx(i), sy(y)]))}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? "6 4" : "0"}
            />
            {s.data.map((y, i) => (
              <circle key={i} cx={sx(i)} cy={sy(y)} r="3" fill="#FFFFFF" stroke={s.color} strokeWidth="2" />
            ))}
          </g>
        ))}

        {hover != null && (
          <g style={{ pointerEvents: "none" }}>
            <line
              x1={sx(hover)}
              x2={sx(hover)}
              y1={PAD.t}
              y2={PAD.t + innerH}
              stroke="var(--rl-gray-500)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {series.map((s, si) => (
              <circle key={si} cx={sx(hover)} cy={sy(s.data[hover])} r="5" fill={s.color} stroke="#FFFFFF" strokeWidth="2" />
            ))}
          </g>
        )}

        {/* Columnas invisibles de captura: van al final para quedar por encima. */}
        {months.map((mk, i) => (
          <rect
            key={"hover-" + i}
            x={sx(i) - colW / 2}
            y={PAD.t}
            width={colW}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "crosshair" }}
          />
        ))}
      </svg>

      {hover != null && (
        <div
          className="rc-chart-tooltip"
          style={{
            left: (sx(hover) / W) * 100 + "%",
            // Cerca del borde derecho el tooltip se voltea para no salirse.
            transform: hover >= n / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            minWidth: 150,
          }}
        >
          <div className="rc-chart-tooltip-title">{monthLabelShort(months[hover])}</div>
          {series.map((s, si) => (
            <div key={si} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <span className="rc-chart-dot" style={{ background: s.color }} />
              <span style={{ flex: 1, opacity: 0.9 }}>
                {s.label}
                {s.unit && s.unit !== unit ? ` (${s.unit})` : ""}
              </span>
              <strong style={{ marginLeft: 8 }}>
                {fmtNum(s.data[hover])} {s.unit || unit}
              </strong>
            </div>
          ))}
        </div>
      )}

      <div className="prt-row" style={{ flexWrap: "wrap", gap: 14, marginTop: 8, padding: "0 8px" }}>
        {series.map((s, i) => (
          <div key={i} className="prt-row" style={{ gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 18,
                height: 0,
                borderTop: `2.5px ${s.dashed ? "dashed" : "solid"} ${s.color}`,
              }}
            />
            <span style={{ font: "600 12px/1 var(--rl-font-display)", color: "var(--rl-gray-800)" }}>
              {s.label}
              {s.unit ? ` (${s.unit})` : ""}
            </span>
            <span className="prt-hint" style={{ fontSize: 11 }}>
              · {fmtNum(s.data.reduce((a, b) => a + b, 0))} {s.unit || unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
