"use client";

// Heatmap sucursal × mes. Portado de proto/dashboard.jsx.
// La intensidad es relativa al máximo de la matriz; las celdas con consumo
// arrancan en 0.08 de opacidad para que un valor bajo no se vea igual a un cero.

import { useState } from "react";
import { fmtNum, monthLabelShort } from "@/lib/domain/format";

const CW = 38;
const CH = 26;
const PAD = 4;
const LAB_W = 116;

export function Heatmap({ months, rows, color, unit }) {
  const [hover, setHover] = useState(null);

  const maxV = Math.max(1, ...rows.flatMap((r) => r.cells));
  const w = LAB_W + months.length * CW + PAD * 2;
  const h = 24 + rows.length * CH + PAD * 2;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block" }}>
          {months.map((mk, c) => (
            <text
              key={c}
              x={LAB_W + c * CW + CW / 2}
              y={16}
              textAnchor="middle"
              fontSize="10"
              fontFamily="var(--rl-font-display)"
              fontWeight="700"
              fill="var(--rl-gray-500)"
            >
              {monthLabelShort(mk).slice(0, 3)}
            </text>
          ))}
          {rows.map((r, ri) => (
            <g key={ri}>
              <text
                x={LAB_W - 8}
                y={24 + ri * CH + 16}
                textAnchor="end"
                fontSize="11"
                fontFamily="var(--rl-font-display)"
                fontWeight="600"
                fill="var(--rl-gray-700)"
              >
                {r.suc}
              </text>
              {r.cells.map((v, ci) => {
                const intensidad = v === 0 ? 0 : Math.max(0.08, v / maxV);
                const activa = hover && hover.ri === ri && hover.ci === ci;
                return (
                  <rect
                    key={ci}
                    x={LAB_W + ci * CW + 1}
                    y={24 + ri * CH + 2}
                    width={CW - 2}
                    height={CH - 4}
                    rx="3"
                    fill={color}
                    fillOpacity={intensidad * 0.85 + (v > 0 ? 0.05 : 0)}
                    stroke={activa ? "var(--rl-gray-900)" : "var(--rl-gray-100)"}
                    strokeWidth={activa ? 1.5 : 0.5}
                    onMouseEnter={() => setHover({ ri, ci, value: v, suc: r.suc, month: months[ci] })}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      {hover && (
        <div
          className="rc-chart-tooltip"
          style={{
            left: ((LAB_W + hover.ci * CW + CW / 2) / w) * 100 + "%",
            top: ((24 + hover.ri * CH) / h) * 100 + "%",
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
        >
          <div className="rc-chart-tooltip-title">{hover.suc}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="rc-chart-dot" style={{ background: color }} />
            <span style={{ opacity: 0.9, textTransform: "capitalize" }}>{monthLabelShort(hover.month)}</span>
            <strong style={{ marginLeft: 8 }}>
              {fmtNum(hover.value)} {unit}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}
