"use client";

// Matriz de carga. Portado de proto/upload-matrix.jsx. Es cliente por dos cosas:
// el selector de mes y las columnas de tipo que se expanden a subcategorías.
//
// El cálculo vive en lib/domain/matriz.js; acá solo se dibuja.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/icons";
import { Select } from "@/components/ui/controls";
import { Card, Chip, EmptyState, Field, SectionHead } from "@/components/ui/layout";
import { monthLabelShort } from "@/lib/domain/format";
import { badgeFila, construirMatriz, estadoAgregado, etiquetaSubcat, TIPOS_MATRIZ } from "@/lib/domain/matriz";

function Casilla({ status }) {
  if (status === "cargado") return <Icon name="check" size={18} style={{ color: "var(--rl-success-600)" }} />;
  if (status === "pendiente") return <Icon name="close" size={18} style={{ color: "var(--rl-error-500)" }} />;
  if (status === "pendiente-soft") return <Icon name="close" size={16} style={{ color: "var(--rl-gray-300)" }} />;
  return <span style={{ color: "var(--rl-gray-300)", font: "600 16px/1 var(--rl-font-display)" }}>—</span>;
}

const LEYENDA = [
  ["cargado", "Cargado"],
  ["pendiente", "Pendiente (mes cerrado)"],
  ["pendiente-soft", "Pendiente (en curso)"],
  ["na", "No aplica"],
];

export function Matriz({ sucursales, records, meses, mesActual }) {
  const [mes, setMes] = useState(mesActual);
  const [expandido, setExpandido] = useState({});

  const { filas, anchoPorTipo, cerrado } = useMemo(
    () => construirMatriz({ sucursales, records, monthKey: mes, mesActual }),
    [sucursales, records, mes, mesActual],
  );

  const alternar = (id) => setExpandido((e) => ({ ...e, [id]: !e[id] }));
  const hayExpandido = TIPOS_MATRIZ.some((t) => expandido[t.id]);

  return (
    <div>
      <SectionHead
        eyebrow="Dashboard / Estado de carga"
        title="Matriz de carga por sucursal"
        sub="Estado de los registros por sucursal y tipo de consumo en el periodo seleccionado."
        right={
          <Link className="prt-btn" href="/dashboard">
            <Icon name="arrow_back" />
            Volver al dashboard
          </Link>
        }
      />

      <div className="prt-row" style={{ gap: 14, marginBottom: 18, alignItems: "center" }}>
        <Field label="Periodo" style={{ width: 240, marginBottom: 0 }}>
          <Select
            value={mes}
            onChange={setMes}
            options={meses.map((mk) => ({ value: mk, label: monthLabelShort(mk) }))}
          />
        </Field>
        {!cerrado && (
          <div className="prt-hint" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="info" size={14} />
            Este periodo aún no cierra — los pendientes se marcan en rojo desde el día 1 del mes siguiente.
          </div>
        )}
      </div>

      {filas.length === 0 ? (
        <EmptyState
          icon="apartment"
          title="No hay sucursales activas"
          body="Agrega al menos una sucursal para ver su estado de carga."
          actions={
            <Link className="prt-btn primary" href="/configuracion/nueva">
              <Icon name="add" />
              Agregar sucursal
            </Link>
          }
        />
      ) : (
        <Card flush>
          <div style={{ overflowX: "auto" }}>
            <table className="prt-table prt-matrix-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Sucursal</th>
                  {TIPOS_MATRIZ.map((t) => {
                    const abierto = !!expandido[t.id];
                    return (
                      <th
                        key={t.id}
                        colSpan={abierto ? anchoPorTipo[t.id] : 1}
                        onClick={() => alternar(t.id)}
                        className="prt-matrix-type-th"
                        style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                        title={abierto ? "Colapsar columna" : "Expandir subcategorías"}
                      >
                        <span className="prt-row" style={{ gap: 6, justifyContent: "center" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              background: t.bg,
                              color: t.color,
                            }}
                          >
                            <Icon name={t.icon} size={14} />
                          </span>
                          {t.label}
                          <Icon name={abierto ? "expand_less" : "expand_more"} size={16} />
                        </span>
                      </th>
                    );
                  })}
                  <th style={{ minWidth: 110, textAlign: "right" }}>Estado</th>
                </tr>
                {hayExpandido && (
                  <tr className="prt-matrix-subhead">
                    <th />
                    {TIPOS_MATRIZ.map((t) => {
                      if (!expandido[t.id]) return <th key={t.id} />;
                      // Las etiquetas salen de la primera sucursal que tenga esa
                      // posición configurada; las columnas están alineadas por
                      // posición, no por nombre.
                      return (
                        <Fragment key={t.id}>
                          {Array.from({ length: anchoPorTipo[t.id] }, (_, i) => {
                            const fila = filas.find((f) => f.porTipo[t.id]?.subcats[i]);
                            const sub = fila?.porTipo[t.id]?.subcats[i]?.cfgSub;
                            return (
                              <th key={i} className="prt-matrix-subhead-cell">
                                {sub ? etiquetaSubcat(t.id, sub) : ""}
                              </th>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                    <th />
                  </tr>
                )}
              </thead>
              <tbody>
                {filas.map(({ suc, porTipo, configuradas, cargadas }) => {
                  const badge = badgeFila({ configuradas, cargadas });
                  return (
                    <tr key={suc.id}>
                      <td>
                        <strong>{suc.nombre}</strong>
                      </td>
                      {TIPOS_MATRIZ.map((t) => {
                        const celda = porTipo[t.id];
                        if (!expandido[t.id]) {
                          const agg = celda.active
                            ? estadoAgregado(celda.subcats.map((s) => s.status))
                            : "na";
                          return (
                            <td key={t.id} style={{ textAlign: "center" }}>
                              <Casilla status={agg} />
                            </td>
                          );
                        }
                        return (
                          <Fragment key={t.id}>
                            {Array.from({ length: anchoPorTipo[t.id] }, (_, i) => (
                              <td key={i} style={{ textAlign: "center" }}>
                                <Casilla status={celda.subcats[i]?.status || "na"} />
                              </td>
                            ))}
                          </Fragment>
                        );
                      })}
                      <td style={{ textAlign: "right" }}>
                        <Chip kind={badge.kind} size="sm">{badge.label}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="prt-row" style={{ gap: 18, marginTop: 14, flexWrap: "wrap" }}>
        {LEYENDA.map(([status, label]) => (
          <span key={status} className="prt-row" style={{ gap: 6 }}>
            <Casilla status={status} />
            <span className="prt-hint" style={{ fontSize: 12 }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
