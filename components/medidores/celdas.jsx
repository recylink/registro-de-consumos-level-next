"use client";

// Celdas editables y adjuntos del módulo Medidores. Portado de proto/medidores.jsx.
//
// Las subidas y borrados de documentos sí van al servidor en el momento (son
// archivos en Drive, no texto): el Server Action devuelve el link y recién
// entonces se guarda en el estado, que después se escribe en la planilla con el
// resto del módulo.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { Btn, NumericInput } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useMedidores } from "@/components/medidores/estado";
import { deleteMedidorDocAction, uploadMedidorDocAction } from "@/app/actions/medidores";
import { errorArchivo } from "@/lib/domain/archivos";
import { meterLabel } from "@/lib/domain/medidores";
import { medUnit, meterReadingFor, priceFor, validateReading } from "@/lib/domain/medidores-calc";

export const DOC_META = {
  factura: { label: "Factura", icon: "receipt_long" },
  pago: { label: "Pago", icon: "payments" },
  respaldo: { label: "Respaldo", icon: "photo_camera" },
};

/** Lectura de un (medidor, mes), con validación contra la lectura anterior. */
export function LecturaCell({ meterId, month }) {
  const { M, setReading } = useMedidores();
  const [msg, setMsg] = useState(null); // { kind, text }
  const guardada = meterReadingFor(M.readings, meterId, month);

  const onChange = (v) => {
    const res = validateReading({ readings: M.readings, meterId, month, value: v });
    setMsg(
      res.error ? { kind: "error", text: res.error } : res.warn ? { kind: "warn", text: res.warn } : null,
    );
    if (res.ok) setReading({ meterId, month, lectura: v });
  };

  return (
    <div className="rc-med-lectura">
      <NumericInput
        value={guardada == null ? "" : guardada}
        onChange={onChange}
        placeholder="—"
        error={msg && msg.kind === "error"}
        style={{ height: 34, textAlign: "right" }}
      />
      {msg && (
        <span className={"rc-med-cellmsg " + msg.kind} title={msg.text}>
          <Icon name={msg.kind === "error" ? "error" : "warning"} size={12} />
        </span>
      )}
    </div>
  );
}

/** Precio unitario de (sucursal, tipo, mes). Compartido por matriz y mensual. */
export function MedPriceInput({ suc, type, month, compact }) {
  const { M, setPrice } = useMedidores();
  const precio = priceFor(M.prices, suc, type, month);
  // ¿el precio que aplica es heredado de un mes anterior?
  const exacto = (M.prices || []).some(
    (p) => p.sucursal === suc && p.type === type && p.month === month,
  );

  return (
    <div className={"rc-med-price" + (compact ? " compact" : "")}>
      <NumericInput
        value={precio == null ? "" : precio}
        placeholder="0"
        suffix={compact ? null : "$/" + (medUnit(type) || "u")}
        onChange={(v) => setPrice({ sucursal: suc, type, month, precio: v })}
        style={{ height: 32, textAlign: "right" }}
      />
      {precio != null && !exacto && (
        <span className="rc-med-price-inh" title="Heredado de un mes anterior">
          <Icon name="info" size={12} />
        </span>
      )}
    </div>
  );
}

/**
 * Confirmar → papelera de Drive → limpiar el estado. Si Drive falla el documento
 * NO se limpia: mejor un link vivo que una fila apuntando a nada.
 */
function useBorrarDoc(meterId, month, kind, doc) {
  const { setDoc } = useMedidores();
  const toast = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const label = DOC_META[kind].label;

  const confirmar = async () => {
    setBorrando(true);
    const res = await deleteMedidorDocAction(doc && doc.fileId);
    setBorrando(false);
    if (!res?.ok) {
      toast.error("No se pudo eliminar", res?.error || "Error inesperado");
      return;
    }
    setDoc({ meterId, month, kind, doc: null });
    toast.success(label + " eliminado", (doc && doc.name) || "");
    setConfirmando(false);
  };

  const dialog = confirmando ? (
    <ConfirmDialog
      icon="delete"
      iconBg="var(--rl-error-50)"
      iconColor="var(--rl-error-500)"
      title={"¿Eliminar " + label.toLowerCase() + "?"}
      description={
        <>
          {doc && doc.name ? (
            <>
              El archivo <strong>{doc.name}</strong> se eliminará
            </>
          ) : (
            <>El archivo se eliminará</>
          )}{" "}
          también de Google Drive. <strong>Esta acción no es reversible.</strong>
        </>
      }
      actions={
        <>
          <Btn onClick={() => setConfirmando(false)} disabled={borrando}>
            Cancelar
          </Btn>
          <Btn kind="danger" icon="delete" onClick={confirmar} disabled={borrando}>
            {borrando ? "Eliminando…" : "Sí, eliminar"}
          </Btn>
        </>
      }
      onClose={borrando ? () => {} : () => setConfirmando(false)}
    />
  ) : null;

  return { pedir: () => setConfirmando(true), dialog };
}

/** Sube un archivo de medidor a Drive y devuelve el documento guardado. */
async function subirDoc({ file, kind, meter, month }) {
  // Sobre el tope, el Server Action corta el cuerpo del request y el error
  // vuelve sin mensaje: mejor devolver el problema como resultado normal.
  const problema = errorArchivo(file);
  if (problema) return { ok: false, error: problema };

  const fd = new FormData();
  fd.set("file", file);
  fd.set("kind", kind);
  fd.set("month", month);
  fd.set("meter", JSON.stringify(meter || null));
  return uploadMedidorDocAction(fd);
}

/** Botón de adjunto (factura / pago / respaldo) de un (medidor, mes). */
export function DocButton({ meterId, month, kind, compact }) {
  const { M, setDoc } = useMedidores();
  const toast = useToast();
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef(null);
  const label = DOC_META[kind].label;
  const doc = ((M.docs || {})[meterId + "__" + month] || {})[kind] || null;

  const onPick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    // El respaldo se archiva en Drive por tipo de consumo → medidor → mes.
    const meter = (M.meters || []).find((x) => x.id === meterId);
    const res = await subirDoc({ file, kind, meter, month });
    setSubiendo(false);
    if (!res?.ok) {
      toast.error("No se pudo subir " + label.toLowerCase(), res?.error || "Error inesperado");
      return;
    }
    setDoc({ meterId, month, kind, doc: res.doc });
    toast.success(label + " adjuntada", file.name);
  };

  const borrar = useBorrarDoc(meterId, month, kind, doc);

  if (doc && doc.link) {
    return (
      <span className={"rc-med-doc has " + kind + (compact ? " compact" : "")}>
        <a href={doc.link} target="_blank" rel="noopener" title={label + ": " + (doc.name || "ver")}>
          <Icon name={DOC_META[kind].icon} size={compact ? 13 : 14} />
          {!compact && <span>{label}</span>}
        </a>
        <button
          onClick={borrar.pedir}
          title={"Eliminar " + label.toLowerCase()}
          aria-label={"Eliminar " + label.toLowerCase()}
        >
          <Icon name="close" size={compact ? 11 : 12} />
        </button>
        {borrar.dialog}
      </span>
    );
  }

  return (
    <button
      className={"rc-med-doc empty " + (compact ? "compact" : "")}
      onClick={() => inputRef.current?.click()}
      disabled={subiendo}
      title={"Subir " + label.toLowerCase()}
    >
      {subiendo ? (
        <span className="prt-spinner" />
      ) : (
        <Icon name={compact ? DOC_META[kind].icon : "cloud_upload"} size={compact ? 13 : 14} />
      )}
      {!compact && <span>{label}</span>}
      {/* Respaldo = foto: en móvil abre el selector nativo cámara/galería. */}
      <input
        ref={inputRef}
        type="file"
        accept={kind === "respaldo" ? "image/*" : undefined}
        style={{ display: "none" }}
        onChange={onPick}
      />
    </button>
  );
}

/**
 * Respaldo destacado de la vista móvil: botón ancho, y con foto cargada una
 * tarjeta con miniatura y acciones de reemplazar o quitar.
 */
export function RespaldoUploader({ meterId, month }) {
  const { M, setDoc } = useMedidores();
  const toast = useToast();
  const [subiendo, setSubiendo] = useState(false);
  // objectURL de la foto recién subida: preview inmediata sin esperar a Drive.
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);
  const doc = ((M.docs || {})[meterId + "__" + month] || {}).respaldo || null;

  // La URL de preview se libera al desmontar o al reemplazar la foto.
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const onPick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    const anterior = doc && doc.fileId;
    const meter = (M.meters || []).find((x) => x.id === meterId);
    const res = await subirDoc({ file, kind: "respaldo", meter, month });
    setSubiendo(false);
    if (!res?.ok) {
      toast.error("No se pudo subir respaldo", res?.error || "Error inesperado");
      return;
    }
    setDoc({ meterId, month, kind: "respaldo", doc: res.doc });
    setPreview(URL.createObjectURL(file));
    toast.success("Respaldo adjuntado", file.name);
    // Reemplazo: la foto anterior va a la papelera para no dejar archivos
    // huérfanos. Best-effort — si falla, la nueva ya quedó vigente.
    if (anterior && anterior !== res.doc.fileId) {
      deleteMedidorDocAction(anterior).catch(() => {});
    }
  };

  const borrar = useBorrarDoc(meterId, month, "respaldo", doc);
  const input = (
    <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPick} />
  );

  if (doc && doc.link) {
    const thumb =
      preview || (doc.fileId ? "https://drive.google.com/thumbnail?id=" + doc.fileId + "&sz=w160" : null);
    return (
      <div className="rc-med-respaldo has">
        <a
          className="rc-med-respaldo-thumb"
          href={doc.link}
          target="_blank"
          rel="noopener"
          title="Ver respaldo"
        >
          <Icon name="photo_camera" size={20} />
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="Respaldo" onError={(e) => (e.target.style.display = "none")} />
          )}
        </a>
        <a className="rc-med-respaldo-info" href={doc.link} target="_blank" rel="noopener">
          <strong>Respaldo cargado</strong>
          <span>{doc.name || "foto"}</span>
        </a>
        <div className="rc-med-respaldo-actions">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
            title="Reemplazar foto"
            aria-label="Reemplazar foto"
          >
            {subiendo ? <span className="prt-spinner" /> : <Icon name="photo_camera" size={16} />}
          </button>
          <button onClick={borrar.pedir} title="Eliminar respaldo" aria-label="Eliminar respaldo">
            <Icon name="close" size={16} />
          </button>
        </div>
        {borrar.dialog}
        {input}
      </div>
    );
  }

  return (
    <button
      className="rc-med-respaldo empty"
      onClick={() => inputRef.current?.click()}
      disabled={subiendo}
    >
      {subiendo ? <span className="prt-spinner" /> : <Icon name="photo_camera" size={18} />}
      <span>{subiendo ? "Subiendo…" : "Agregar respaldo (foto)"}</span>
      {input}
    </button>
  );
}

/**
 * ⚠ con la lista de medidores que no suman al total. El tooltip va en un portal
 * con position fixed porque dentro de la celda lo recorta el overflow de la
 * tabla (mismo truco que el menú del Select).
 */
export function MedNoFactTip({ meters }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  const mostrar = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top - 8, left: r.left + r.width / 2 });
  };

  return (
    <span
      ref={ref}
      onMouseEnter={mostrar}
      onMouseLeave={() => setPos(null)}
      style={{ marginLeft: 6, verticalAlign: "middle", display: "inline-flex", cursor: "help" }}
    >
      <Icon name="warning" size={14} style={{ color: "var(--rl-warning-500)" }} />
      {pos &&
        createPortal(
          <span
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              transform: "translate(-50%, -100%)",
              background: "var(--rl-gray-900)",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: 8,
              font: "500 12px/16px var(--rl-font-body)",
              whiteSpace: "nowrap",
              zIndex: 1000,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              No suman al total (configurados para no facturar):
            </div>
            {meters.map((m) => (
              <div key={m.id}>· {meterLabel(m)}</div>
            ))}
          </span>,
          document.body,
        )}
    </span>
  );
}
