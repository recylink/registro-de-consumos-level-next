"use client";

// Tabla detallada del dashboard: orden por columna, paginado, edición inline,
// eliminar/restaurar y adjuntar documento. Portado de RecentTable
// (proto/dashboard.jsx).
//
// Cada edición va directo a la celda de la planilla vía Server Action. El
// prototipo, en cambio, tocaba el reducer y recién después emitía un evento
// `rc:edit` — y solo lo emitía si `origen === "sheets"`, así que editar o
// eliminar un registro cargado como "manual", "documento" o "foto" cambiaba la
// pantalla y no la planilla: al refrescar volvía como estaba. Acá todos los
// registros vienen de la planilla y todos se guardan igual.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Btn, Select } from "@/components/ui/controls";
import { Card, Chip, TypeIndicator } from "@/components/ui/layout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAccion } from "@/components/use-accion";
import { attachDocumentAction, editRecordAction } from "@/app/actions/records";
import { TYPES, subcatLabel } from "@/lib/domain/catalog";
import { fmtCLP, fmtMonth, fmtNum } from "@/lib/domain/format";
import { getProviderOptionsFor, getSubcatsFor } from "@/lib/domain/sucursales";

const PAGE_SIZE = 10;
const NUMERICAS = new Set(["cantidad", "costo"]);

const ORIGEN_CHIP = {
  documento: { icon: "picture_as_pdf", label: "Documento" },
  manual: { icon: "edit", label: "Manual" },
  foto: { icon: "photo_camera", label: "Foto" },
  sheets: { icon: "cloud", label: "Importado" },
};

function valorDeOrden(r, key) {
  switch (key) {
    case "date": return r.date || "";
    case "sucursal": return r.sucursal || "";
    case "type": return TYPES[r.type]?.label || r.type || "";
    case "subcat": return r.subcat ? subcatLabel(r.type, r.subcat) || r.subcat : "";
    case "provider": return r.provider || "";
    case "cantidad": return Number(r.cantidad) || 0;
    case "costo": return Number(r.costo) || 0;
    case "origen": return r.origen || "";
    case "estado": return r.estado || "";
    default: return "";
  }
}

function ThOrdenable({ keyId, sortKey, sortDir, onClick, num, children }) {
  const activa = sortKey === keyId;
  return (
    <th
      className={num ? "num" : ""}
      onClick={() => onClick(keyId)}
      title={"Ordenar por " + (typeof children === "string" ? children.toLowerCase() : "esta columna")}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
        {activa ? (
          <Icon name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"} size={12} style={{ opacity: 0.85 }} />
        ) : (
          <Icon name="unfold_more" size={12} style={{ opacity: 0.25 }} />
        )}
      </span>
    </th>
  );
}

function CeldaNumero({ defaultValue, onCommit, onCancel }) {
  const [v, setV] = useState(String(defaultValue));
  return (
    <input
      type="number"
      className="rc-cell-input num"
      value={v}
      autoFocus
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(v);
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

// Editor de mes. showPicker() abre el desplegable nativo al entrar a editar y al
// clickear cualquier parte del input, no solo el ícono de calendario.
function CeldaMes({ defaultValue, max, onCommit, onCancel }) {
  const [v, setV] = useState(String(defaultValue || "").slice(0, 7));
  const ref = useRef(null);
  const abrir = () => {
    try {
      ref.current?.showPicker();
    } catch {
      // Navegador sin showPicker: el input sigue siendo usable.
    }
  };
  useEffect(abrir, []);
  return (
    <input
      ref={ref}
      type="month"
      className="rc-cell-input"
      value={v}
      autoFocus
      max={max}
      onClick={abrir}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(v);
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

function CeldaSelect({ defaultValue, options, onCommit, onCancel, allowFreeText }) {
  const v = String(defaultValue || "");
  const opts = (options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  // Conserva el valor actual aunque no esté en las opciones: proveedores
  // escritos a mano en la planilla no deben desaparecer al abrir el editor.
  const full = !opts.some((o) => o.value === v) && v ? [{ value: v, label: v }, ...opts] : opts;

  if (allowFreeText && full.length === 0) {
    return (
      <input
        type="text"
        className="rc-cell-input compact"
        defaultValue={v}
        autoFocus
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(e.currentTarget.value);
          if (e.key === "Escape") onCancel();
        }}
      />
    );
  }
  return (
    <Select
      size="sm"
      autoFocus
      value={v}
      options={full}
      onChange={onCommit}
      onClose={onCancel}
      style={{ width: "100%" }}
    />
  );
}

export function DashboardTabla({ registros, sucursales, estado, onEstado, mesActual }) {
  const toast = useToast();
  const { correr } = useAccion();
  const [editing, setEditing] = useState(null); // { id, field }
  const [modal, setModal] = useState(null); // { accion, rec }
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const [adjuntando, setAdjuntando] = useState(null);
  const fileRef = useRef(null);

  const ordenados = useMemo(() => {
    const mult = sortDir === "asc" ? 1 : -1;
    return [...registros].sort((a, b) => {
      const va = valorDeOrden(a, sortKey);
      const vb = valorDeOrden(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
      return String(va).localeCompare(String(vb), "es", { sensitivity: "base" }) * mult;
    });
  }, [registros, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages - 1) setPage(0);
  }, [totalPages, page]);

  const pagina = Math.min(page, totalPages - 1);
  const filas = ordenados.slice(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE);
  const desde = ordenados.length === 0 ? 0 : pagina * PAGE_SIZE + 1;
  const hasta = pagina * PAGE_SIZE + filas.length;

  const ordenar = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Números y fechas parten descendente: lo más alto o más reciente primero.
      setSortDir(NUMERICAS.has(key) || key === "date" ? "desc" : "asc");
    }
  };

  // Guarda una celda y ofrece deshacer volviendo a escribir el valor anterior.
  const guardarCelda = (id, field, value, { titulo, cuerpo, anterior }) => {
    correr(() => editRecordAction({ id, field, value }), {
      exito: {
        title: titulo,
        body: cuerpo,
      },
      onExito: () => {
        if (anterior === undefined) return;
        toast.show({
          kind: "success",
          title: titulo,
          body: cuerpo,
          undoAction: () => correr(() => editRecordAction({ id, field, value: anterior })),
        });
      },
    });
    setEditing(null);
  };

  const editarNumero = (rec, field, raw) => {
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || rec[field] === parsed) {
      setEditing(null);
      return;
    }
    guardarCelda(rec.id, field, parsed, {
      titulo: field === "cantidad" ? "Cantidad actualizada" : "Costo actualizado",
      cuerpo: `${rec.sucursal} · ${TYPES[rec.type].label} · ${fmtMonth(rec.date)} · ${fmtNum(rec[field])} → ${fmtNum(parsed)}${field === "cantidad" ? " " + rec.unit : ""}`,
      anterior: rec[field],
    });
  };

  const editarMes = (rec, value) => {
    const mk = String(value || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mk) || String(rec.date).slice(0, 7) === mk) {
      setEditing(null);
      return;
    }
    // El mes se guarda como día 15: la fecha del Registro representa el período.
    const iso = mk + "-15";
    guardarCelda(rec.id, "date", iso, {
      titulo: "Mes actualizado",
      cuerpo: `${rec.sucursal} · ${TYPES[rec.type].label} · ${fmtMonth(rec.date)} → ${fmtMonth(iso)}`,
      anterior: rec.date,
    });
  };

  const editarSubcat = (rec, value) => {
    if (rec.subcat === value) {
      setEditing(null);
      return;
    }
    // La planilla guarda la etiqueta legible, no el id interno.
    const label = value ? subcatLabel(rec.type, value) : "";
    guardarCelda(rec.id, "subcat", label, {
      titulo: "Subcategoría actualizada",
      cuerpo: `${rec.sucursal} · ${TYPES[rec.type].label} · ${label || "—"}`,
    });
  };

  const editarProveedor = (rec, value) => {
    const v = String(value || "").trim();
    if (rec.provider === v) {
      setEditing(null);
      return;
    }
    guardarCelda(rec.id, "provider", v, {
      titulo: "Proveedor actualizado",
      cuerpo: `${rec.sucursal} · ${TYPES[rec.type].label} · ${v || "—"}`,
    });
  };

  const cambiarEstado = (rec, eliminar) => {
    setModal(null);
    correr(() => editRecordAction({ id: rec.id, field: "estado", value: eliminar ? "Eliminada" : "Activa" }), {
      exito: eliminar
        ? {
            title: "Registro eliminado",
            body: 'Se marcó como eliminado. Puedes restaurarlo desde el filtro "Solo eliminadas".',
          }
        : {
            title: "Registro restaurado",
            body: "El registro está activo y se incluye nuevamente en los cálculos.",
          },
    });
  };

  const elegirArchivo = (rec) => {
    setAdjuntando(rec);
    fileRef.current?.click();
  };

  const subirAdjunto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const rec = adjuntando;
    setAdjuntando(null);
    if (!file || !rec) return;
    toast.info("Subiendo documento…", file.name);
    const fd = new FormData();
    fd.set("recordId", rec.id);
    fd.set("file", file);
    correr(() => attachDocumentAction(fd), {
      exito: { title: "Documento adjuntado", body: file.name },
    });
  };

  const editandoEs = (id, field) => editing?.id === id && editing.field === field;

  return (
    <Card flush>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={subirAdjunto}
      />

      <div className="prt-card-head">
        <div>
          <div className="prt-h3">Tabla detallada · últimos registros</div>
          <div className="prt-hint" style={{ marginTop: 2 }}>
            Edita una celda haciendo clic. Los cambios se guardan al instante (con opción de deshacer).
          </div>
        </div>
        <div className="prt-row" style={{ gap: 8 }}>
          <Select
            size="sm"
            style={{ width: 160 }}
            value={estado}
            onChange={onEstado}
            options={[
              { value: "activa", label: "Solo activas" },
              { value: "eliminada", label: "Solo eliminadas" },
              { value: "all", label: "Todas" },
            ]}
          />
          <Chip size="sm">
            {desde}–{hasta} de {ordenados.length}
          </Chip>
        </div>
      </div>

      {estado === "all" && (
        <div className="rc-tabla-aviso">
          <Icon name="info" size={14} />
          Los registros eliminados se muestran pero no se incluyen en los totales del dashboard.
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="prt-table">
          <thead>
            <tr>
              <ThOrdenable keyId="date" sortKey={sortKey} sortDir={sortDir} onClick={ordenar}>Mes</ThOrdenable>
              <ThOrdenable keyId="sucursal" sortKey={sortKey} sortDir={sortDir} onClick={ordenar}>Sucursal</ThOrdenable>
              <ThOrdenable keyId="type" sortKey={sortKey} sortDir={sortDir} onClick={ordenar}>Tipo</ThOrdenable>
              <ThOrdenable keyId="subcat" sortKey={sortKey} sortDir={sortDir} onClick={ordenar}>Subcategoría</ThOrdenable>
              <ThOrdenable keyId="provider" sortKey={sortKey} sortDir={sortDir} onClick={ordenar}>Proveedor</ThOrdenable>
              <ThOrdenable keyId="cantidad" sortKey={sortKey} sortDir={sortDir} onClick={ordenar} num>Cantidad</ThOrdenable>
              <ThOrdenable keyId="costo" sortKey={sortKey} sortDir={sortDir} onClick={ordenar} num>Costo (CLP)</ThOrdenable>
              <ThOrdenable keyId="origen" sortKey={sortKey} sortDir={sortDir} onClick={ordenar}>Origen</ThOrdenable>
              <th>Documento</th>
              <ThOrdenable keyId="estado" sortKey={sortKey} sortDir={sortDir} onClick={ordenar}>Estado</ThOrdenable>
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => {
              const borrado = r.estado === "eliminada";
              const tdDel = borrado ? "td-del" : "";
              const chip = ORIGEN_CHIP[r.origen];
              // La electricidad no se subdivide, así que su celda no se edita.
              const subcatEditable = !borrado && r.type !== "electricidad";
              return (
                <tr key={r.id} className={"editable" + (borrado ? " row-deleted" : "")}>
                  <td
                    className={tdDel + (editandoEs(r.id, "date") ? " cell-edit" : "")}
                    onClick={() => !borrado && setEditing({ id: r.id, field: "date" })}
                    style={{ cursor: borrado ? "default" : "pointer" }}
                  >
                    {editandoEs(r.id, "date") ? (
                      <CeldaMes
                        defaultValue={r.date}
                        max={mesActual}
                        onCommit={(v) => editarMes(r, v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      fmtMonth(r.date)
                    )}
                  </td>
                  <td className={tdDel}>{r.sucursal}</td>
                  <td>
                    <TypeIndicator type={r.type} withLabel />
                  </td>
                  <td
                    className={tdDel + (editandoEs(r.id, "subcat") ? " cell-edit" : "")}
                    onClick={() => subcatEditable && setEditing({ id: r.id, field: "subcat" })}
                    style={{ cursor: subcatEditable ? "pointer" : "default" }}
                  >
                    {editandoEs(r.id, "subcat") ? (
                      <CeldaSelect
                        defaultValue={r.subcat || ""}
                        options={getSubcatsFor(sucursales, r.type, r.sucursal).map((s) => ({
                          value: s.id,
                          label: s.label,
                        }))}
                        onCommit={(v) => editarSubcat(r, v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : r.subcat ? (
                      <Chip>{subcatLabel(r.type, r.subcat)}</Chip>
                    ) : (
                      <span className="prt-hint">—</span>
                    )}
                  </td>
                  <td
                    className={tdDel + (editandoEs(r.id, "provider") ? " cell-edit" : "")}
                    onClick={() => !borrado && setEditing({ id: r.id, field: "provider" })}
                    style={{ cursor: borrado ? "default" : "pointer" }}
                  >
                    {editandoEs(r.id, "provider") ? (
                      <CeldaSelect
                        defaultValue={r.provider || ""}
                        options={getProviderOptionsFor(sucursales, r.sucursal, r.type)}
                        allowFreeText
                        onCommit={(v) => editarProveedor(r, v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      r.provider || <span className="prt-hint">—</span>
                    )}
                  </td>
                  <td
                    className={"num " + tdDel + (editandoEs(r.id, "cantidad") ? " cell-edit" : "")}
                    onClick={() => !borrado && setEditing({ id: r.id, field: "cantidad" })}
                    style={{ cursor: borrado ? "default" : "pointer" }}
                  >
                    {editandoEs(r.id, "cantidad") ? (
                      <CeldaNumero
                        defaultValue={r.cantidad}
                        onCommit={(v) => editarNumero(r, "cantidad", v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <span>
                        <strong>{fmtNum(r.cantidad)}</strong> <span className="prt-hint">{r.unit}</span>
                      </span>
                    )}
                  </td>
                  <td
                    className={"num " + tdDel + (editandoEs(r.id, "costo") ? " cell-edit" : "")}
                    onClick={() => !borrado && setEditing({ id: r.id, field: "costo" })}
                    style={{ cursor: borrado ? "default" : "pointer" }}
                  >
                    {editandoEs(r.id, "costo") ? (
                      <CeldaNumero
                        defaultValue={r.costo}
                        onCommit={(v) => editarNumero(r, "costo", v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      fmtCLP(r.costo)
                    )}
                  </td>
                  <td>{chip && <Chip size="sm" icon={chip.icon}>{chip.label}</Chip>}</td>
                  <td className={tdDel}>
                    {r._driveLink ? (
                      <a
                        className="rc-doc-link"
                        href={r._driveLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={r.factura || "Ver documento"}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Icon name="picture_as_pdf" size={14} />
                        <span>Ver</span>
                        <Icon name="open_in_new" size={12} />
                      </a>
                    ) : !borrado ? (
                      <button
                        className="rc-doc-attach"
                        title="Adjuntar documento"
                        onClick={(e) => {
                          e.stopPropagation();
                          elegirArchivo(r);
                        }}
                      >
                        <Icon name="cloud_upload" size={14} />
                        <span>Adjuntar</span>
                      </button>
                    ) : (
                      <span className="prt-hint">—</span>
                    )}
                  </td>
                  <td>
                    {borrado ? (
                      <Chip kind="error" size="sm">Eliminada</Chip>
                    ) : (
                      <Chip kind="success" size="sm">Activa</Chip>
                    )}
                  </td>
                  <td style={{ textAlign: "center", padding: "0 4px" }}>
                    <button
                      className="ob-icon-btn sm"
                      title={borrado ? "Restaurar registro" : "Eliminar registro"}
                      style={{ color: borrado ? "var(--rl-success-500)" : "var(--rl-gray-400)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ accion: borrado ? "restaurar" : "eliminar", rec: r });
                      }}
                    >
                      <Icon name={borrado ? "refresh" : "delete"} size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={11} style={{ padding: 32, textAlign: "center", color: "var(--rl-gray-500)" }}>
                  No hay registros que coincidan con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ordenados.length > PAGE_SIZE && (
        <div className="rc-tabla-pie">
          <span className="prt-hint" style={{ font: "500 12px/1 var(--rl-font-body)" }}>
            Mostrando {desde}–{hasta} de {ordenados.length} registros
          </span>
          <div className="prt-row" style={{ gap: 6 }}>
            <Btn size="sm" kind="ghost" icon="chevron_left" disabled={pagina === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Anterior
            </Btn>
            <span className="prt-hint" style={{ font: "600 12px/1 var(--rl-font-body)", padding: "0 8px", alignSelf: "center" }}>
              Página {pagina + 1} de {totalPages}
            </span>
            <Btn
              size="sm"
              kind="ghost"
              iconRight="chevron_right"
              disabled={pagina >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Siguiente
            </Btn>
          </div>
        </div>
      )}

      {modal && (
        <ConfirmDialog
          icon={modal.accion === "eliminar" ? "delete" : "refresh"}
          iconBg={modal.accion === "eliminar" ? "var(--rl-error-50)" : "var(--rl-success-50)"}
          iconColor={modal.accion === "eliminar" ? "var(--rl-error-500)" : "var(--rl-success-700)"}
          title={modal.accion === "eliminar" ? "¿Eliminar este registro?" : "¿Restaurar este registro?"}
          description={
            modal.accion === "eliminar"
              ? "Quedará marcado como eliminado y no se incluirá en los cálculos del dashboard, pero podrás restaurarlo más adelante."
              : "Volverá a estar activo y se incluirá nuevamente en los cálculos del dashboard."
          }
          detail={
            <div>
              <div>
                <strong>{modal.rec.sucursal}</strong> · {TYPES[modal.rec.type].label}
              </div>
              <div>
                {fmtMonth(modal.rec.date)} · {fmtNum(modal.rec.cantidad)} {modal.rec.unit} ·{" "}
                {fmtCLP(modal.rec.costo)}
              </div>
            </div>
          }
          onClose={() => setModal(null)}
          actions={
            <>
              <Btn onClick={() => setModal(null)}>Cancelar</Btn>
              {modal.accion === "eliminar" ? (
                <Btn kind="danger" icon="delete" onClick={() => cambiarEstado(modal.rec, true)}>
                  Eliminar
                </Btn>
              ) : (
                <Btn kind="primary" icon="check" onClick={() => cambiarEstado(modal.rec, false)}>
                  Restaurar
                </Btn>
              )}
            </>
          }
        />
      )}
    </Card>
  );
}
