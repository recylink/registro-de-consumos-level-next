"use client";

// Registro manual. Portado de proto/manual.jsx: un lote comparte mes y sucursal,
// y lleva N consumos. Tres pasos —datos, revisar, listo— que acá son estado
// local del componente, no del estado global de la app.
//
// Los archivos adjuntos vivían en `window.__rcManualFacturas`, un objeto global
// indexado por id de consumo, porque un File no entraba en el reducer
// serializable. Acá van en el estado de React junto al resto del consumo, y al
// guardar se mandan como FormData al Server Action.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Btn, Input, MonthPicker, NumericInput, Select } from "@/components/ui/controls";
import { Card, Chip, Field, SectionHead, Steps, TypeIndicator } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { submitManualAction } from "@/app/actions/records";
import { TYPES, subcatLabel } from "@/lib/domain/catalog";
import { detectAnomaly } from "@/lib/domain/anomalia";
import { errorArchivo, errorLote, tamanoLegible } from "@/lib/domain/archivos";
import { fmtCLP, fmtMonth, fmtNum } from "@/lib/domain/format";
import { nextEntryId, nextRecordId } from "@/lib/domain/ids";
import {
  activeSucNames, getConfiguredProvider, getEntryUnit, getProviderOptionsFor, getSubcatsFor,
} from "@/lib/domain/sucursales";

const PASOS = ["Datos", "Revisar", "Listo"];

const nuevoConsumo = () => ({
  id: nextEntryId(),
  type: "",
  subcat: "",
  provider: "",
  cantidad: "",
  costo: "",
  notes: "",
  factura: null, // File
  // El proveedor se autocompleta desde la config hasta que el usuario lo toca.
  providerAuto: true,
});

function validar(draft, sucursales) {
  const errors = { entries: {} };
  if (!draft.date) errors.date = "Indica el mes.";
  if (!draft.sucursal) errors.sucursal = "Elige una sucursal.";

  for (const e of draft.entries) {
    const ee = {};
    if (!e.type) ee.type = "Indica el tipo.";
    if (e.type && getSubcatsFor(sucursales, e.type, draft.sucursal).length > 0 && !e.subcat) {
      ee.subcat = "Requiere subcategoría.";
    }
    if (!e.cantidad) ee.cantidad = "Ingresa la cantidad.";
    else if (isNaN(parseFloat(e.cantidad)) || parseFloat(e.cantidad) <= 0) ee.cantidad = "Debe ser > 0.";
    if (e.costo && (isNaN(parseFloat(e.costo)) || parseFloat(e.costo) < 0)) ee.costo = "Debe ser ≥ 0.";
    if (Object.keys(ee).length) errors.entries[e.id] = ee;
  }

  const hayErrores = errors.date || errors.sucursal || Object.keys(errors.entries).length > 0;
  return hayErrores ? errors : {};
}

function AdjuntarFactura({ file, onPick }) {
  const inputRef = useRef(null);
  return (
    <Field label="Factura o boleta (opcional)" helper="PDF o imagen — se adjunta a este consumo.">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          onPick(e.target.files?.[0] || null);
          e.target.value = "";
        }}
      />
      {file ? (
        <div
          className="prt-row"
          style={{
            gap: 10,
            padding: "10px 14px",
            background: "var(--rl-gray-50)",
            border: "1.5px solid var(--rl-gray-200)",
            borderRadius: 8,
          }}
        >
          <Icon name="picture_as_pdf" size={18} style={{ color: "var(--rl-primary-900)" }} />
          <span
            style={{
              flex: 1,
              font: "500 13px/1 var(--rl-font-body)",
              color: "var(--rl-gray-900)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </span>
          <span className="prt-hint" style={{ whiteSpace: "nowrap" }}>{tamanoLegible(file.size)}</span>
          <Btn size="sm" kind="ghost" onClick={() => inputRef.current?.click()}>Cambiar</Btn>
          <Btn size="sm" kind="ghost" onClick={() => onPick(null)} icon="close" title="Quitar archivo" />
        </div>
      ) : (
        <button type="button" className="rc-dashed-btn" onClick={() => inputRef.current?.click()}>
          <Icon name="cloud_upload" size={18} />
          <span>Adjuntar factura o boleta</span>
        </button>
      )}
    </Field>
  );
}

function AvisoAtipico({ anomaly, unidad, sucursal }) {
  if (!anomaly) return null;
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: "var(--rl-warning-50)",
        border: "1px solid var(--rl-warning-200)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <Icon name="warning" size={18} style={{ color: "var(--rl-warning-700)", flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ font: "600 12px/16px var(--rl-font-display)", color: "var(--rl-warning-700)" }}>
          Consumo {anomaly.direction === "up" ? "más alto" : "más bajo"} de lo habitual
        </div>
        <div className="prt-hint" style={{ fontSize: 12, marginTop: 2, color: "var(--rl-warning-800)" }}>
          {anomaly.pct > 0 ? "+" : ""}
          {anomaly.pct}% vs. promedio {fmtNum(anomaly.avg)} {unidad} en {sucursal}.
        </div>
      </div>
    </div>
  );
}

function ConsumoCard({ entry, index, total, sucursal, sucursales, records, errors, onChange, onRemove }) {
  const subcatOpts = entry.type ? getSubcatsFor(sucursales, entry.type, sucursal) : [];
  const pideSubcat = entry.type && subcatOpts.length > 0;
  const unidad = entry.type ? getEntryUnit(sucursales, sucursal, entry.type, entry.subcat) : "";
  const unidadPendiente = entry.type === "combustible" && pideSubcat && !entry.subcat;
  const anomaly = detectAnomaly(records, sucursal, entry);
  const t = entry.type ? TYPES[entry.type] : null;
  const ee = errors || {};

  return (
    <Card style={{ marginBottom: 14 }}>
      <div className="prt-spread" style={{ marginBottom: 14, alignItems: "center" }}>
        <div className="prt-row" style={{ gap: 10 }}>
          <span className="rc-step-num">{index + 1}</span>
          <div className="prt-h4">Consumo {index + 1}</div>
          {t && (
            <Chip size="sm">
              <TypeIndicator type={entry.type} /> {t.label}
            </Chip>
          )}
        </div>
        {total > 1 && (
          <Btn size="sm" kind="ghost" icon="delete" onClick={onRemove} title="Quitar este consumo">
            Quitar
          </Btn>
        )}
      </div>

      <div className="prt-stack-md">
        <div style={{ display: "grid", gridTemplateColumns: pideSubcat ? "1fr 1fr" : "1fr", gap: 16 }}>
          <Field label="Tipo de consumo" required error={ee.type}>
            <Select
              value={entry.type}
              onChange={(v) => onChange({ type: v })}
              options={Object.values(TYPES).map((tt) => ({
                value: tt.id,
                label: `${tt.label} (${tt.unit})`,
                icon: tt.icon,
                iconBg: tt.bg,
                iconColor: tt.color,
              }))}
              placeholder="Elige un tipo…"
              error={!!ee.type}
            />
          </Field>
          {pideSubcat && (
            <Field label="Subcategoría" required error={ee.subcat}>
              <Select
                value={entry.subcat}
                onChange={(v) => onChange({ subcat: v })}
                options={subcatOpts.map((s) => ({
                  value: s.id,
                  label: s.unidad ? `${s.label} · ${s.unidad}` : s.label,
                }))}
                placeholder="Elige una subcategoría…"
                error={!!ee.subcat}
              />
            </Field>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field
            label="Cantidad consumida"
            required
            error={ee.cantidad}
            helper={
              !entry.type
                ? "Elige primero el tipo."
                : entry.type === "combustible" && !sucursal
                  ? "Elige primero la sucursal."
                  : unidadPendiente
                    ? "Elige la subcategoría para fijar la unidad."
                    : `Unidad: ${unidad}`
            }
          >
            <NumericInput
              value={entry.cantidad}
              onChange={(v) => onChange({ cantidad: v })}
              placeholder="0"
              suffix={unidadPendiente ? "" : unidad}
              error={!!ee.cantidad}
            />
          </Field>
          <Field label="Costo total (opcional)" error={ee.costo}>
            <NumericInput
              value={entry.costo}
              onChange={(v) => onChange({ costo: v })}
              placeholder="0"
              suffix="CLP"
              error={!!ee.costo}
              allowDecimal={false}
            />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Proveedor (opcional)">
            <Select
              value={entry.provider}
              onChange={(v) => onChange({ provider: v, providerAuto: false })}
              options={entry.type ? getProviderOptionsFor(sucursales, sucursal, entry.type) : []}
              placeholder="Elige un proveedor…"
            />
          </Field>
          <Field label="Notas (opcional)" helper={`${(entry.notes || "").length}/120`}>
            <Input
              value={entry.notes}
              onChange={(v) => onChange({ notes: v.slice(0, 120) })}
              placeholder="Ej. Lectura tomada el día 28"
            />
          </Field>
        </div>

        <AdjuntarFactura file={entry.factura} onPick={(f) => onChange({ factura: f })} />
        <AvisoAtipico anomaly={anomaly} unidad={unidad} sucursal={sucursal} />
      </div>
    </Card>
  );
}

export function ManualFlujo({ sucursales, records, mesActual }) {
  const router = useRouter();
  const toast = useToast();
  const [paso, setPaso] = useState(0); // 0 datos · 1 revisar · 2 listo
  const [draft, setDraft] = useState({ date: "", sucursal: "", entries: [nuevoConsumo()] });
  const [errors, setErrors] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [guardados, setGuardados] = useState(0);

  const nombres = activeSucNames(sucursales);

  const setShared = (field, value) => {
    setDraft((d) => {
      const next = { ...d, [field]: value };
      // Cambiar de sucursal cambia qué subcategorías y proveedores existen: los
      // valores elegidos ya no aplican.
      if (field === "sucursal") {
        next.entries = d.entries.map((e) => ({ ...e, subcat: "", provider: "", providerAuto: true }));
      }
      return next;
    });
    setErrors((e) => {
      const { [field]: _, ...resto } = e;
      return resto;
    });
  };

  // Autocompletado de proveedor: al fijar tipo (sin subcategorías) o
  // subcategoría, se propone el proveedor configurado para esa sucursal. Se
  // detiene en cuanto el usuario elige uno a mano.
  const cambiarConsumo = (id, patch) => {
    // Un adjunto gigante hace estallar el límite de cuerpo del Server Action al
    // guardar, y el error llega al navegador sin mensaje. Se rechaza acá.
    if (patch.factura) {
      const problema = errorArchivo(patch.factura);
      if (problema) {
        toast.error("Archivo demasiado grande", problema);
        return;
      }
    }
    setDraft((d) => ({
      ...d,
      entries: d.entries.map((e) => {
        if (e.id !== id) return e;
        const next = { ...e, ...patch };
        if (patch.type !== undefined) {
          next.subcat = "";
          if (next.providerAuto !== false) {
            const sinSubcats = next.type && getSubcatsFor(sucursales, next.type, d.sucursal).length === 0;
            next.provider = sinSubcats
              ? getConfiguredProvider(sucursales, d.sucursal, next.type, "") || ""
              : "";
          }
        } else if (patch.subcat !== undefined && next.providerAuto !== false) {
          next.provider = getConfiguredProvider(sucursales, d.sucursal, next.type, next.subcat) || "";
        }
        return next;
      }),
    }));
    setErrors((prev) => {
      const campo = Object.keys(patch)[0];
      const entradas = { ...(prev.entries || {}) };
      if (entradas[id]) {
        const { [campo]: _, ...resto } = entradas[id];
        entradas[id] = resto;
      }
      return { ...prev, entries: entradas };
    });
  };

  const limpiar = () => {
    setDraft({ date: "", sucursal: "", entries: [nuevoConsumo()] });
    setErrors({});
    setPaso(0);
  };

  const revisar = () => {
    const e = validar(draft, sucursales);
    setErrors(e);
    if (Object.keys(e).length === 0) setPaso(1);
  };

  const confirmar = async () => {
    // El lote entero (registros + adjuntos) viaja en un solo request: si la suma
    // de facturas se pasa del límite, se avisa antes de enviar.
    const excede = errorLote(draft.entries.map((e) => e.factura));
    if (excede) {
      toast.error("Los adjuntos del lote son demasiado grandes", excede);
      return;
    }

    setGuardando(true);
    const cantidad = draft.entries.length;

    // El mes elegido se guarda como día 15, punto medio del mes: la fecha del
    // Registro representa el período, no un día concreto.
    const fecha = draft.date?.length === 7 ? draft.date + "-15" : draft.date;

    const fd = new FormData();
    const registros = draft.entries.map((e) => ({
      id: nextRecordId(),
      date: fecha,
      sucursal: draft.sucursal,
      type: e.type,
      subcat: e.subcat || null,
      provider: e.provider || "—",
      cantidad: parseFloat(e.cantidad),
      unit: getEntryUnit(sucursales, draft.sucursal, e.type, e.subcat),
      costo: parseFloat(e.costo) || 0,
      origen: "manual",
      estado: "activa",
      notes: e.notes || "",
    }));
    fd.set("records", JSON.stringify(registros));
    draft.entries.forEach((e, i) => {
      if (e.factura) fd.append(`factura:${registros[i].id}`, e.factura);
    });

    const res = await submitManualAction(fd);
    setGuardando(false);

    if (!res.ok) {
      toast.error("No se pudo guardar el lote", res.error);
      return;
    }
    // Las subidas de archivo que fallan no abortan el lote: el consumo se guarda
    // sin adjunto y se avisa.
    for (const p of res.problemas || []) toast.warning("Atención", p);
    setGuardados(res.written ?? cantidad);
    setPaso(2);
    router.refresh();
  };

  if (paso === 2) {
    return (
      <div>
        <SectionHead
          eyebrow="Registrar consumo"
          title="Lote guardado"
          right={
            <Link className="prt-btn" href="/dashboard">
              <Icon name="dashboard" />
              Ver en dashboard
            </Link>
          }
        />
        <div style={{ marginBottom: 22 }}>
          <Steps items={PASOS} current={2} />
        </div>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "8px 0" }}>
            <div className="rc-success-circle">
              <Icon name="check_circle" size={32} fill />
            </div>
            <div className="prt-grow">
              <div className="prt-h2">
                Listo, {guardados === 1 ? "registramos 1 consumo" : `registramos ${guardados} consumos`}
              </div>
              <div className="prt-muted" style={{ marginTop: 4 }}>
                Quedaron escritos en la planilla y ya se reflejan en el dashboard.
              </div>
            </div>
            <Chip kind="success" icon="check">Lote guardado</Chip>
          </div>
        </Card>
        <div className="prt-row" style={{ marginTop: 22, gap: 12 }}>
          <Btn kind="primary" icon="add" onClick={limpiar}>Registrar otro lote</Btn>
          <Link className="prt-btn" href="/registrar/subir">
            <Icon name="cloud_upload" />
            Subir un documento
          </Link>
          <Link className="prt-btn" href="/dashboard">
            <Icon name="dashboard" />
            Ir al dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (paso === 1) {
    const costoTotal = draft.entries.reduce((a, e) => a + (parseFloat(e.costo) || 0), 0);
    return (
      <div>
        <SectionHead
          eyebrow="Registrar consumo · paso 2 de 2"
          title={`Revisa ${draft.entries.length} consumo${draft.entries.length !== 1 ? "s" : ""}`}
          sub="Si todo está correcto, guarda. También puedes volver a editar."
          right={
            <Btn kind="ghost" icon="arrow_back" onClick={() => setPaso(0)}>Editar datos</Btn>
          }
        />
        <div style={{ marginBottom: 22 }}>
          <Steps items={PASOS} current={1} />
        </div>

        <Card style={{ marginBottom: 14 }}>
          <div className="prt-eyebrow" style={{ marginBottom: 10 }}>Datos del lote</div>
          <div className="prt-row" style={{ gap: 28, flexWrap: "wrap" }}>
            <div>
              <div className="prt-hint">Mes</div>
              <div className="rc-dato">{fmtMonth(draft.date)}</div>
            </div>
            <div>
              <div className="prt-hint">Sucursal</div>
              <div className="rc-dato">{draft.sucursal}</div>
            </div>
            <div>
              <div className="prt-hint">Consumos</div>
              <div className="rc-dato">{draft.entries.length}</div>
            </div>
            {costoTotal > 0 && (
              <div>
                <div className="prt-hint">Costo total</div>
                <div className="rc-dato strong">{fmtCLP(costoTotal)}</div>
              </div>
            )}
          </div>
        </Card>

        <div className="prt-stack-md">
          {draft.entries.map((e, i) => {
            const t = TYPES[e.type];
            const sub = e.subcat ? subcatLabel(e.type, e.subcat) : null;
            const unidad = getEntryUnit(sucursales, draft.sucursal, e.type, e.subcat);
            const anomaly = detectAnomaly(records, draft.sucursal, e);
            return (
              <Card key={e.id}>
                <div className="prt-row" style={{ gap: 14, alignItems: "center", marginBottom: 12 }}>
                  <span className="rc-step-num">{i + 1}</span>
                  <div className="prt-row" style={{ gap: 8 }}>
                    <TypeIndicator type={e.type} /> <strong>{t?.label}</strong>
                    {sub && <Chip size="sm">{sub}</Chip>}
                  </div>
                  <div style={{ marginLeft: "auto", font: "700 18px/1 var(--rl-font-display)" }}>
                    {fmtNum(parseFloat(e.cantidad))}{" "}
                    <span style={{ font: "600 13px/1 var(--rl-font-display)", color: "var(--rl-gray-500)" }}>
                      {unidad}
                    </span>
                  </div>
                </div>
                <div className="prt-row" style={{ gap: 28, flexWrap: "wrap" }}>
                  <div><span className="prt-hint">Proveedor: </span><span>{e.provider || "—"}</span></div>
                  <div>
                    <span className="prt-hint">Costo: </span>
                    <span>{e.costo ? fmtCLP(parseFloat(e.costo)) : "—"}</span>
                  </div>
                  {e.factura && (
                    <div>
                      <span className="prt-hint">Factura: </span>
                      <span className="prt-row" style={{ gap: 4, display: "inline-flex" }}>
                        <Icon name="picture_as_pdf" size={14} style={{ color: "var(--rl-primary-900)" }} />
                        <span>{e.factura.name}</span>
                      </span>
                    </div>
                  )}
                  {e.notes && <div><span className="prt-hint">Notas: </span><span>{e.notes}</span></div>}
                </div>
                {anomaly && (
                  <div style={{ marginTop: 10, color: "var(--rl-warning-700)", font: "500 12px/16px var(--rl-font-body)" }}>
                    ⚠ Valor atípico: {anomaly.pct > 0 ? "+" : ""}
                    {anomaly.pct}% vs. promedio {fmtNum(anomaly.avg)} {unidad}.
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div className="prt-spread" style={{ marginTop: 22 }}>
          <Btn icon="arrow_back" onClick={() => setPaso(0)} disabled={guardando}>Volver a editar</Btn>
          <Btn kind="primary" icon="check" onClick={confirmar} disabled={guardando}>
            {guardando
              ? "Guardando…"
              : `Confirmar y guardar ${draft.entries.length} consumo${draft.entries.length !== 1 ? "s" : ""}`}
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHead
        eyebrow="Registrar consumo · paso 1 de 2"
        title="Ingresa los datos del consumo"
        sub="La fecha y sucursal aplican a todos los consumos del lote. Puedes agregar varios."
        right={
          <Link className="prt-btn" href="/registrar">
            <Icon name="arrow_back" />
            Volver
          </Link>
        }
      />
      <div style={{ marginBottom: 22 }}>
        <Steps items={PASOS} current={0} />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <div className="prt-eyebrow" style={{ marginBottom: 12 }}>Datos compartidos del lote</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Mes del consumo" required error={errors.date}>
            <MonthPicker
              value={draft.date}
              onChange={(v) => setShared("date", v)}
              max={mesActual}
              error={!!errors.date}
            />
          </Field>
          <Field label="Sucursal" required error={errors.sucursal}>
            <Select
              value={draft.sucursal}
              onChange={(v) => setShared("sucursal", v)}
              options={nombres}
              placeholder={nombres.length ? "Elige una sucursal…" : "Sin sucursales activas"}
              error={!!errors.sucursal}
            />
          </Field>
        </div>
        {nombres.length === 0 && (
          <div className="prt-help error" style={{ marginTop: 12 }}>
            <Icon name="error" size={14} />
            <span>
              No hay sucursales activas. <Link href="/configuracion/nueva">Crea una</Link> antes de
              registrar consumos.
            </span>
          </div>
        )}
      </Card>

      {draft.date && draft.sucursal ? (
        <>
          {draft.entries.map((entry, i) => (
            <ConsumoCard
              key={entry.id}
              entry={entry}
              index={i}
              total={draft.entries.length}
              sucursal={draft.sucursal}
              sucursales={sucursales}
              records={records}
              errors={errors.entries?.[entry.id]}
              onChange={(patch) => cambiarConsumo(entry.id, patch)}
              onRemove={() =>
                setDraft((d) => {
                  const restantes = d.entries.filter((e) => e.id !== entry.id);
                  return { ...d, entries: restantes.length ? restantes : [nuevoConsumo()] };
                })
              }
            />
          ))}

          <button
            className="rc-manual-add-entry"
            onClick={() => setDraft((d) => ({ ...d, entries: [...d.entries, nuevoConsumo()] }))}
          >
            <Icon name="add" size={18} />
            <span>Agregar otro consumo</span>
          </button>

          <div className="prt-spread" style={{ marginTop: 22 }}>
            <Link className="prt-btn" href="/">Cancelar</Link>
            <div className="prt-row">
              <Btn onClick={limpiar}>Limpiar todo</Btn>
              <Btn kind="primary" iconRight="arrow_forward" onClick={revisar}>
                Revisar {draft.entries.length} consumo{draft.entries.length !== 1 ? "s" : ""}
              </Btn>
            </div>
          </div>
        </>
      ) : (
        <Card>
          <div className="prt-row" style={{ gap: 10, alignItems: "center" }}>
            <Icon name="info" size={18} style={{ color: "var(--rl-gray-500)" }} />
            <span className="prt-muted">
              Completa fecha y sucursal para empezar a registrar consumos.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
