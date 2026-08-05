"use client";

// Metas de reducción. Portado de proto/metas.jsx.
//
// El botón "Guardar metas" del prototipo solo mostraba un toast y navegaba: la
// escritura ocurría antes, por diffing en el puente de sincronización. Acá el
// botón guarda de verdad, y mientras haya cambios sin guardar se avisa.
//
// El icono "history" que usaba el bloque de año base no existe en el set de
// iconos, así que el prototipo dibujaba el cuadrado punteado de "icono
// inexistente". Se reemplaza por calendar_today.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Btn, Select } from "@/components/ui/controls";
import { Card, Chip, Field, SectionHead } from "@/components/ui/layout";
import { useGuardarEmisiones } from "@/components/views/guardar-emisiones";
import { fmtTon } from "@/lib/domain/format";
import { agregadoEmisiones, emisionesDelAnio, emisionesPorSucursal } from "@/lib/domain/emisiones-calc";

const PRIMER_ANIO_BASE = 2021;

function MetaEditor({ meta, onPatch, anualActual, baseAutomatica, aniosBase }) {
  const modo = meta.baseMode === "auto" ? "auto" : "manual";
  const autoBase = baseAutomatica(meta.anioBase);
  const base = modo === "auto" ? autoBase : parseFloat(meta.baseEmissions) || 0;
  const abs = parseFloat(meta.absoluta) || 0;
  const rel = parseFloat(meta.relativa) || 0;
  // Reducción que implica la meta absoluta, para ver si las dos metas son coherentes.
  const relDesdeAbs = base > 0 ? ((base - abs) / base) * 100 : 0;

  return (
    <div className="prt-stack-md">
      <div className="emis-meta-card">
        <div className="prt-row" style={{ gap: 10, marginBottom: 14 }}>
          <span
            className="prt-kpi-ico"
            style={{ width: 38, height: 38, background: "var(--rl-gray-100)", color: "var(--rl-gray-700)" }}
          >
            <Icon name="calendar_today" size={18} />
          </span>
          <div>
            <div className="prt-h4">Año base</div>
            <div className="prt-hint">Punto de comparación del inventario</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
          <Field label="Año base">
            <Select
              value={String(meta.anioBase)}
              options={aniosBase.map((a) => ({ value: String(a), label: String(a) }))}
              onChange={(v) => onPatch({ anioBase: parseInt(v, 10) })}
            />
          </Field>
          <Field label="Fuente de emisiones">
            <div className="prt-row" style={{ gap: 6 }}>
              <button
                className={"prt-pill" + (modo === "auto" ? " active" : "")}
                onClick={() => onPatch({ baseMode: "auto" })}
              >
                Desde registros
              </button>
              <button
                className={"prt-pill" + (modo === "manual" ? " active" : "")}
                onClick={() => onPatch({ baseMode: "manual" })}
              >
                Manual
              </button>
            </div>
          </Field>
          <Field label={`Emisiones en ${meta.anioBase}`}>
            <div className="prt-input-wrap has-suffix">
              {modo === "auto" ? (
                <input
                  className="prt-input"
                  value={fmtTon(autoBase, 1)}
                  readOnly
                  disabled
                  style={{ background: "var(--rl-gray-50)", color: "var(--rl-gray-700)" }}
                />
              ) : (
                <input
                  className="prt-input"
                  type="number"
                  min="0"
                  value={meta.baseEmissions ?? ""}
                  onChange={(e) => onPatch({ baseEmissions: e.target.value })}
                  placeholder="Ej: 2100"
                />
              )}
              <span className="prt-suffix">tCO₂e</span>
            </div>
          </Field>
        </div>
        {modo === "auto" && autoBase === 0 ? (
          <div className="prt-hint" style={{ marginTop: 8, color: "var(--rl-warning-700, #B45309)" }}>
            <Icon name="warning" size={13} /> No hay consumos registrados en {meta.anioBase}. Cambia a
            «Manual» e ingresa el total de tu inventario de ese año.
          </div>
        ) : (
          <div className="prt-hint" style={{ marginTop: 8 }}>
            {modo === "auto"
              ? `Calculado desde los consumos registrados en ${meta.anioBase} con los factores vigentes.`
              : `Total de tu inventario GEI en ${meta.anioBase}. Sin este valor no se puede calcular la reducción lograda.`}
            {anualActual > 0 && (
              <>
                {" "}
                Referencia: últimos 12 meses ≈{" "}
                <strong style={{ color: "var(--rl-gray-700)" }}>{fmtTon(anualActual, 0)}</strong> tCO₂e.
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="emis-meta-card">
          <div className="prt-row" style={{ gap: 10, marginBottom: 14 }}>
            <span
              className="prt-kpi-ico"
              style={{ width: 38, height: 38, background: "var(--rl-primary-50)", color: "var(--rl-primary-900)" }}
            >
              <Icon name="eco" size={18} />
            </span>
            <div>
              <div className="prt-h4">Meta absoluta</div>
              <div className="prt-hint">Emisiones máximas por año</div>
            </div>
          </div>
          <Field label="Tope anual de emisiones">
            <div className="prt-input-wrap has-suffix">
              <input
                className="prt-input"
                type="number"
                value={meta.absoluta}
                onChange={(e) => onPatch({ absoluta: e.target.value })}
                placeholder="Ej: 1850"
              />
              <span className="prt-suffix">tCO₂e/año</span>
            </div>
          </Field>
          {base > 0 && abs > 0 && (
            <div className="prt-hint" style={{ marginTop: 8 }}>
              Equivale a{" "}
              <strong style={{ color: "var(--rl-gray-700)" }}>{fmtTon(relDesdeAbs, 1)}%</strong> de
              reducción vs. {meta.anioBase}.
            </div>
          )}
        </div>

        <div className="emis-meta-card">
          <div className="prt-row" style={{ gap: 10, marginBottom: 14 }}>
            <span
              className="prt-kpi-ico"
              style={{ width: 38, height: 38, background: "var(--rl-success-50)", color: "var(--rl-success-700)" }}
            >
              <Icon name="percent" size={18} />
            </span>
            <div>
              <div className="prt-h4">Meta relativa</div>
              <div className="prt-hint">Reducción vs. año base</div>
            </div>
          </div>
          <Field label="Reducción objetivo">
            <div className="prt-input-wrap has-suffix">
              <input
                className="prt-input"
                type="number"
                value={meta.relativa}
                onChange={(e) => onPatch({ relativa: e.target.value })}
                placeholder="30"
              />
              <span className="prt-suffix">%</span>
            </div>
          </Field>
          {rel > 0 && base > 0 && (
            <div className="prt-hint" style={{ marginTop: 8 }}>
              Objetivo:{" "}
              <strong style={{ color: "var(--rl-gray-700)" }}>{fmtTon(base * (1 - rel / 100), 0)}</strong>{" "}
              tCO₂e/año.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Metas({ emissions: inicial, records, sucursales, mesActual, anioActual }) {
  const router = useRouter();
  const { guardarEmisiones, pending } = useGuardarEmisiones(inicial);
  const [emissions, setEmissions] = useState(inicial);
  const [sucios, setSucios] = useState(false);

  const ctx = { records, sucursales, emissions, anchor: mesActual };
  // Referencia visual: emisiones de los últimos 12 meses, no base de cálculo.
  const anual = agregadoEmisiones(ctx).total;
  const porSucursal = emisionesPorSucursal(ctx, "all");
  const anualDe = (id) => porSucursal.find((s) => s.id === id)?.tco2e || 0;

  // Desde 2021 hasta el último año calendario completo.
  const aniosBase = [];
  for (let a = PRIMER_ANIO_BASE; a <= anioActual - 1; a++) aniosBase.push(a);

  const metas = emissions.metas;

  const patchEmpresa = (patch) => {
    setSucios(true);
    setEmissions((e) => ({
      ...e,
      metas: { ...e.metas, empresa: { ...e.metas.empresa, ...patch } },
    }));
  };

  const patchSucursal = (sucId, patch) => {
    setSucios(true);
    setEmissions((e) => ({
      ...e,
      metas: {
        ...e.metas,
        sucursales: { ...e.metas.sucursales, [sucId]: { ...(e.metas.sucursales[sucId] || {}), ...patch } },
      },
    }));
  };

  const quitarMetaSucursal = (suc) => {
    const { [suc.id]: _, ...resto } = emissions.metas.sucursales;
    const siguiente = { ...emissions, metas: { ...emissions.metas, sucursales: resto } };
    setEmissions(siguiente);
    setSucios(false);
    guardarEmisiones(siguiente, {
      exito: {
        title: "Meta restablecida",
        body: `${suc.nombre} vuelve a heredar la meta de empresa.`,
      },
    });
  };

  const guardar = () => {
    setSucios(false);
    guardarEmisiones(emissions, {
      exito: {
        title: "Metas guardadas",
        body: "Los objetivos de reducción se aplicaron al dashboard de impacto.",
      },
      onExito: () => router.push("/impacto"),
    });
  };

  return (
    <div>
      <SectionHead
        eyebrow="Impacto Ambiental / Configuración"
        title="Metas de reducción"
        sub="Establece objetivos de reducción de emisiones a nivel de empresa y, opcionalmente, por sucursal."
        right={
          <Link className="prt-btn" href="/impacto">
            <Icon name="arrow_back" />
            Volver al impacto
          </Link>
        }
      />

      <Card style={{ marginBottom: 18 }}>
        <div className="prt-spread" style={{ marginBottom: 18 }}>
          <div className="prt-row" style={{ gap: 12 }}>
            <span
              className="prt-kpi-ico"
              style={{ width: 44, height: 44, background: "var(--rl-primary-900)", color: "#FFFFFF" }}
            >
              <Icon name="factory" size={20} />
            </span>
            <div>
              <div className="prt-h2">Meta de empresa</div>
              <div className="prt-hint">Objetivo corporativo</div>
            </div>
          </div>
          <Chip kind="info" size="sm">Últimos 12 meses ≈ {fmtTon(anual, 0)} tCO₂e</Chip>
        </div>
        <MetaEditor
          meta={metas.empresa}
          anualActual={anual}
          aniosBase={aniosBase}
          baseAutomatica={(year) => emisionesDelAnio(ctx, year, null)}
          onPatch={patchEmpresa}
        />
      </Card>

      <div className="prt-spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="prt-h3">Metas por sucursal</div>
          <div className="prt-hint" style={{ marginTop: 2 }}>
            Cada sucursal puede heredar la meta de empresa o definir la suya propia.
          </div>
        </div>
      </div>

      <div className="prt-stack-md">
        {sucursales.length === 0 && (
          <div className="rc-todo">
            Sin sucursales configuradas: por ahora solo aplica la meta de empresa.
          </div>
        )}
        {sucursales.map((suc) => {
          const propia = !!metas.sucursales[suc.id];
          const meta = metas.sucursales[suc.id] || {
            absoluta: "",
            relativa: "",
            anioBase: metas.empresa.anioBase,
            baseEmissions: "",
          };
          return (
            <Card key={suc.id} flush>
              <div className="prt-card-head">
                <div className="prt-row" style={{ gap: 12 }}>
                  <span
                    className="prt-kpi-ico"
                    style={{ width: 38, height: 38, background: "var(--rl-gray-100)", color: "var(--rl-gray-600)" }}
                  >
                    <Icon name="apartment" size={18} />
                  </span>
                  <div>
                    <div className="prt-h4">{suc.nombre}</div>
                    <div className="prt-hint">
                      {propia ? "Meta propia definida" : "Hereda la meta de empresa"} · últimos 12m ≈{" "}
                      {fmtTon(anualDe(suc.id), 0)} tCO₂e
                    </div>
                  </div>
                  {!suc.activa && <Chip size="sm">Inactiva</Chip>}
                </div>
                {propia ? (
                  <Btn size="sm" kind="ghost" icon="undo" disabled={pending} onClick={() => quitarMetaSucursal(suc)}>
                    Volver a heredar
                  </Btn>
                ) : (
                  <Btn
                    size="sm"
                    icon="add"
                    onClick={() =>
                      patchSucursal(suc.id, {
                        absoluta: "",
                        relativa: metas.empresa.relativa,
                        anioBase: metas.empresa.anioBase,
                        baseEmissions: "",
                        baseMode: metas.empresa.baseMode || "manual",
                      })
                    }
                  >
                    Definir meta propia
                  </Btn>
                )}
              </div>
              {propia && (
                <div style={{ padding: "18px 22px 22px" }}>
                  <MetaEditor
                    meta={meta}
                    anualActual={anualDe(suc.id)}
                    aniosBase={aniosBase}
                    baseAutomatica={(year) => emisionesDelAnio(ctx, year, suc.nombre)}
                    onPatch={(patch) => patchSucursal(suc.id, patch)}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="prt-row" style={{ justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 22 }}>
        {sucios && (
          <span className="prt-hint" style={{ fontSize: 12 }}>
            <Icon name="info" size={13} /> Hay cambios sin guardar.
          </span>
        )}
        <Btn kind="primary" icon="check" onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar metas"}
        </Btn>
      </div>
    </div>
  );
}
