"use client";

// Área mensual de emisiones. Portado de EmisAreaChart (proto/impacto.jsx).
// El id del gradiente lleva el color para que dos gráficos con colores distintos
// en la misma página no compartan defs (en el prototipo el id era fijo,
// "emisGrad", así que el segundo gráfico heredaba el gradiente del primero).

import { useId, useState } from "react";
import { fmtTon, monthLabelShort } from "@/lib/domain/format";
import { smoothPath } from "@/components/charts/smooth";

const W = 640;
const PAD = { l: 46, r: 16, t: 18, b: 28 };
const TICKS = [0, 0.25, 0.5, 0.75, 1];

export function AreaEmisiones({ months, data, color = "var(--rl-success-600)", h = 230 }) {
  const [hover, setHover] = useState(null);
  const gradId = useId();

  const innerW = W - PAD.l - PAD.r;
  const innerH = h - PAD.t - PAD.b;
  const n = months.length;
  // 10% de aire sobre el máximo, para que el punto más alto no toque el borde.
  const yMax = Math.max(...data, 1) * 1.1;
  const sx = (i) => PAD.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const sy = (y) => PAD.t + (1 - y / yMax) * innerH;
  const colW = n > 1 ? innerW / (n - 1) : innerW;

  const line = smoothPath(data.map((y, i) => [sx(i), sy(y)]));
  const area =
    line +
    ` L${sx(n - 1).toFixed(1)},${(PAD.t + innerH).toFixed(1)}` +
    ` L${sx(0).toFixed(1)},${(PAD.t + innerH).toFixed(1)} Z`;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${h}`} width="100%" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

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
            {fmtTon(yMax * t, 0)}
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
          tCO₂e
        </text>

        {months.map((mk, i) =>
          n > 6 && i % Math.ceil(n / 6) !== 0 ? null : (
            <text
              key={i}
              x={sx(i)}
              y={h - 8}
              textAnchor="middle"
              fontSize="10"
              fontFamily="var(--rl-font-display)"
              fill="var(--rl-gray-500)"
            >
              {monthLabelShort(mk)}
            </text>
          ),
        )}

        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((y, i) => (
          <circle key={i} cx={sx(i)} cy={sy(y)} r="3" fill="#FFFFFF" stroke={color} strokeWidth="2" />
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
            <circle cx={sx(hover)} cy={sy(data[hover])} r="5" fill={color} stroke="#FFFFFF" strokeWidth="2" />
          </g>
        )}

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
          />
        ))}
      </svg>

      {hover != null && (
        <div
          className="rc-chart-tooltip"
          style={{
            left: (sx(hover) / W) * 100 + "%",
            top: (sy(data[hover]) / h) * 100 + "%",
            transform: "translate(-50%, calc(-100% - 12px))",
          }}
        >
          <div className="rc-chart-tooltip-title">{monthLabelShort(months[hover])}</div>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
            {fmtTon(data[hover])} <span style={{ opacity: 0.7, fontSize: 11 }}>tCO₂e</span>
          </div>
        </div>
      )}
    </div>
  );
}
