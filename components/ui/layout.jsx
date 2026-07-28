// Primitivas presentacionales: sin estado ni manejadores propios, así que
// funcionan como componentes de servidor. Las que necesitan interacción viven en
// controls.jsx, que sí es cliente. La separación evita arrastrar media UI al
// bundle del navegador solo por usar una Card.

import { Fragment } from "react";
import { Icon } from "@/components/icons";
import { TYPES } from "@/lib/domain/catalog";

export function Card({ children, style, flush, bordered, className }) {
  return (
    <div
      className={
        "prt-card" +
        (flush ? " flush" : "") +
        (bordered ? " bordered" : "") +
        (className ? " " + className : "")
      }
      style={style}
    >
      {children}
    </div>
  );
}

export function SectionHead({ eyebrow, title, sub, right }) {
  return (
    <div className="prt-spread" style={{ marginBottom: 18 }}>
      <div>
        {eyebrow && <div className="prt-eyebrow">{eyebrow}</div>}
        <h1 className="prt-h1" style={{ marginTop: 4 }}>{title}</h1>
        {sub && <div className="prt-muted" style={{ marginTop: 6, maxWidth: 640 }}>{sub}</div>}
      </div>
      {right && <div className="prt-row">{right}</div>}
    </div>
  );
}

/** Envoltorio de campo de formulario: etiqueta, control y ayuda/error. */
export function Field({ label, required, helper, helperKind, error, children, style }) {
  return (
    <div className="prt-field" style={style}>
      {label && (
        <label className="prt-label">
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {(error || helper) && (
        <div className={"prt-help" + (error ? " error" : helperKind ? " " + helperKind : "")}>
          {error && <Icon name="error" size={14} />}
          <span>{error || helper}</span>
        </div>
      )}
    </div>
  );
}

export function Chip({ children, kind, size, icon, dot, onClose }) {
  return (
    <span className={"prt-chip" + (kind ? " " + kind : "") + (size ? " " + size : "")}>
      {dot && <span className="dot" />}
      {icon && <Icon name={icon} size={14} />}
      {children}
      {onClose && (
        <button
          onClick={onClose}
          style={{ all: "unset", cursor: "pointer", marginLeft: 4, display: "inline-flex" }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </span>
  );
}

/** Punto de color + icono del tipo de consumo. */
export function TypeIndicator({ type, withLabel }) {
  const t = TYPES[type];
  if (!t) return null;
  return (
    <span className="prt-row" style={{ gap: 8 }}>
      <span className={"prt-type-dot " + type}>
        <Icon name={t.icon} size={16} />
      </span>
      {withLabel && (
        <span style={{ font: "600 13px/1 var(--rl-font-display)", color: "var(--rl-gray-800)" }}>
          {t.label}
        </span>
      )}
    </span>
  );
}

export function Steps({ items, current }) {
  return (
    <div className="prt-steps">
      {items.map((it, i) => {
        const isActive = i === current;
        const isDone = i < current;
        const cls = isActive ? "active" : isDone ? "done" : "";
        return (
          <Fragment key={i}>
            <span className={"prt-step " + cls}>
              <span className="num">{isDone ? <Icon name="check" size={14} /> : i + 1}</span>
              <span>{it}</span>
            </span>
            {i < items.length - 1 && <span className={"prt-step-sep" + (isDone ? " done" : "")} />}
          </Fragment>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon = "inbox", title, body, actions }) {
  return (
    <div className="prt-empty">
      <div className="icon-circle">
        <Icon name={icon} />
      </div>
      <div>
        <div className="prt-h2">{title}</div>
        {body && <div className="prt-muted" style={{ marginTop: 6, maxWidth: 460 }}>{body}</div>}
      </div>
      {actions && <div className="prt-row" style={{ marginTop: 4 }}>{actions}</div>}
    </div>
  );
}
