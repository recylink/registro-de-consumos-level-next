"use client";

// Diálogo de confirmación. Portado de proto/config.jsx. Se agregó cierre con
// Esc, que antes solo se lograba con click en el fondo.

import { useEffect } from "react";
import { Icon } from "@/components/icons";

export function ConfirmDialog({
  icon, iconBg, iconColor, title, description, detail, actions, onClose,
}) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="prt-modal-scrim" onClick={onClose}>
      <div
        className="prt-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              flexShrink: 0,
              background: iconBg || "var(--rl-error-50)",
              color: iconColor || "var(--rl-error-500)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={icon} size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <div className="prt-h4">{title}</div>
            <div className="prt-hint" style={{ marginTop: 4, lineHeight: 1.5 }}>{description}</div>
          </div>
        </div>
        {detail && (
          <div
            style={{
              background: "var(--rl-gray-50)",
              borderRadius: 8,
              padding: "12px 14px",
              font: "500 13px/1.5 var(--rl-font-body)",
              color: "var(--rl-gray-700)",
              marginBottom: 20,
            }}
          >
            {detail}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>{actions}</div>
      </div>
    </div>
  );
}
