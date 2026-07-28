"use client";

// Tabla de revisión de las filas extraídas. Portada de proto/preview.jsx.
//
// Corrección: las opciones de subcategoría salían de `state.subcategories[type]`,
// el catálogo estático, así que para agua y combustible ofrecía valores que no
// necesariamente existen en la sucursal (y omitía los que sí). Ahora salen de la
// configuración de la sucursal de la fila, igual que en el registro manual y en la
// tabla del dashboard.

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Btn, Select } from "@/components/ui/controls";
import { Card, Chip, Steps, SectionHead, TypeIndicator } from "@/components/ui/layout";
import { TYPES, subcatLabel } from "@/lib/domain/catalog";
import { fmtCLP, fmtDate, fmtNum } from "@/lib/domain/format";
import { activeSucNames, getSubcatsFor } from "@/lib/domain/sucursales";

const PASOS = ["Proveedor", "Subir", "Revisar"];

const RESUMEN = [
  { estado: "ok", icon: "check_circle", clase: "success", texto: (n) => `${n} ${n === 1 ? "registro listo" : "registros listos"} para guardar` },
  { estado: "warn", icon: "warning", clase: "warning", texto: (n) => `${n} con datos incompletos — revisar` },
  { estado: "error", icon: "error", clase: "error", texto: (n) => `${n} con campos vacíos — completa o elimina` },
];

function CeldaNum({ value, onChange, onBlur }) {
  return (
    <input
      type="number"
      className="rc-cell-input num"
      value={value}
      autoFocus
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function FilaPreview({ row, sucursales, hoy, onUpdate, onDuplicar, onEliminar }) {
  const [editando, setEditando] = useState(null);
  const cerrar = () => setEditando(null);

  const subOpts = getSubcatsFor(sucursales, row.type, row.sucursal);
  const clase = row.status === "warn" ? "row-warn" : row.status === "error" ? "row-error" : "";

  return (
    <tr className={"editable " + clase}>
      <td>
        {row.status === "warn" && <Icon name="warning" size={18} style={{ color: "var(--rl-warning-700)" }} />}
        {row.status === "error" && <Icon name="error" size={18} style={{ color: "var(--rl-error-700)" }} />}
        {row.status === "ok" && (
          <Icon name="check_circle" size={18} style={{ color: "var(--rl-success-600)" }} fill />
        )}
      </td>

      <td onClick={() => setEditando("date")} className={editando === "date" ? "cell-edit" : ""}>
        {editando === "date" ? (
          <input
            type="date"
            className="rc-cell-input"
            value={row.date}
            autoFocus
            max={hoy}
            onChange={(e) => onUpdate({ date: e.target.value })}
            onBlur={cerrar}
          />
        ) : (
          fmtDate(row.date)
        )}
      </td>

      <td onClick={() => setEditando("sucursal")} className={editando === "sucursal" ? "cell-edit" : ""}>
        {editando === "sucursal" ? (
          <Select
            size="sm"
            autoFocus
            value={row.sucursal}
            options={activeSucNames(sucursales).map((s) => ({ value: s, label: s }))}
            onChange={(v) => {
              onUpdate({ sucursal: v });
              cerrar();
            }}
            onClose={cerrar}
            style={{ width: "100%" }}
          />
        ) : (
          row.sucursal || <em style={{ color: "var(--rl-gray-400)" }}>elegir…</em>
        )}
      </td>

      {/* Viene del documento: no se edita. */}
      <td>
        {row.numeroCliente ? (
          <span style={{ font: "500 13px/1 var(--rl-font-body)", color: "var(--rl-gray-700)" }}>
            {row.numeroCliente}
          </span>
        ) : (
          <span className="prt-hint">—</span>
        )}
      </td>

      <td>
        <TypeIndicator type={row.type} withLabel />
      </td>

      <td onClick={() => subOpts.length > 0 && setEditando("subcat")} className={editando === "subcat" ? "cell-edit" : ""}>
        {editando === "subcat" && subOpts.length > 0 ? (
          <Select
            size="sm"
            autoFocus
            value={row.subcat || ""}
            options={subOpts.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(v) => {
              onUpdate({ subcat: v });
              cerrar();
            }}
            onClose={cerrar}
            style={{ width: "100%" }}
          />
        ) : row.subcat ? (
          <Chip>{subcatLabel(row.type, row.subcat)}</Chip>
        ) : subOpts.length > 0 ? (
          <em style={{ color: "var(--rl-gray-400)" }}>elegir…</em>
        ) : (
          <span className="prt-hint">—</span>
        )}
      </td>

      <td className={"num" + (editando === "cantidad" ? " cell-edit" : "")} onClick={() => setEditando("cantidad")}>
        {editando === "cantidad" ? (
          <CeldaNum value={row.cantidad} onChange={(v) => onUpdate({ cantidad: v })} onBlur={cerrar} />
        ) : row.cantidad === "" ? (
          <span style={{ color: "var(--rl-error-700)", fontStyle: "italic" }}>vacío</span>
        ) : (
          <span>
            {fmtNum(row.cantidad)}{" "}
            <span style={{ color: "var(--rl-gray-500)", fontSize: 12 }}>{TYPES[row.type].unit}</span>
          </span>
        )}
      </td>

      <td className={"num" + (editando === "costo" ? " cell-edit" : "")} onClick={() => setEditando("costo")}>
        {editando === "costo" ? (
          <CeldaNum value={row.costo} onChange={(v) => onUpdate({ costo: v })} onBlur={cerrar} />
        ) : row.costo === "" ? (
          <span style={{ color: "var(--rl-error-700)", fontStyle: "italic" }}>vacío</span>
        ) : (
          fmtCLP(row.costo)
        )}
      </td>

      <td>
        <span className="prt-hint rc-nombre-archivo" title={row.sourceFile}>{row.sourceFile}</span>
      </td>

      <td>
        <div className="prt-row" style={{ gap: 4 }}>
          <button className="ob-icon-btn sm rc-icon-hover" title="Duplicar fila" onClick={onDuplicar}>
            <Icon name="content_copy" size={16} />
          </button>
          <button
            className="ob-icon-btn sm rc-icon-hover"
            title="Eliminar fila"
            style={{ color: "var(--rl-error-600)" }}
            onClick={onEliminar}
          >
            <Icon name="delete" size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function SubirPreview({ rows, sucursales, hoy, guardando, onUpdate, onDuplicar, onEliminar, onVolver, onCancelar, onConfirmar }) {
  const conteo = {
    ok: rows.filter((r) => r.status === "ok").length,
    warn: rows.filter((r) => r.status === "warn").length,
    error: rows.filter((r) => r.status === "error").length,
  };
  // Se guardan todas menos las que están en error.
  const aGuardar = rows.length - conteo.error;

  return (
    <div>
      <SectionHead
        eyebrow="Subir documento · paso 3 de 3"
        title="Revisa los datos extraídos"
        sub="Haz clic en cualquier celda para editarla. Los datos no se guardan hasta que confirmes."
        right={
          <Btn kind="ghost" icon="arrow_back" onClick={onVolver}>Volver a la cola</Btn>
        }
      />
      <div style={{ marginBottom: 22 }}>
        <Steps items={PASOS} current={2} />
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {RESUMEN.filter((r) => conteo[r.estado] > 0 || r.estado === "ok").map((r) => (
          <div key={r.estado} className={"rc-resumen-pill " + r.clase}>
            <Icon name={r.icon} size={18} />
            <span>{r.texto(conteo[r.estado])}</span>
          </div>
        ))}
      </div>

      <Card flush>
        <div className="prt-card-head">
          <div className="prt-h3">{rows.length} filas detectadas</div>
          <div className="prt-hint">Editables · click en celda</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="prt-table">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>Fecha</th>
                <th>Sucursal</th>
                <th>N° cliente</th>
                <th>Tipo</th>
                <th>Subcategoría</th>
                <th className="num">Cantidad</th>
                <th className="num">Costo (CLP)</th>
                <th>Archivo</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FilaPreview
                  key={r.id}
                  row={r}
                  sucursales={sucursales}
                  hoy={hoy}
                  onUpdate={(patch) => onUpdate(r.id, patch)}
                  onDuplicar={() => onDuplicar(r.id)}
                  onEliminar={() => onEliminar(r.id)}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 32, textAlign: "center", color: "var(--rl-gray-500)" }}>
                    No quedaron filas por revisar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="prt-spread" style={{ marginTop: 22 }}>
        <Btn kind="ghost" onClick={onCancelar} disabled={guardando}>Cancelar todo</Btn>
        <Btn kind="primary" icon="check" disabled={guardando || aGuardar === 0} onClick={onConfirmar}>
          {guardando
            ? "Guardando…"
            : `Guardar ${aGuardar} registro${aGuardar !== 1 ? "s" : ""}` +
              (conteo.error > 0 ? ` (omitir ${conteo.error} con error)` : "")}
        </Btn>
      </div>
    </div>
  );
}
