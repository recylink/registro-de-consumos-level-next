"use client";

// Aviso de deploy nuevo. Portado del VersionWatcher del prototipo, que leía
// `version.json` generado por GitHub Actions; acá consulta /api/version, que
// devuelve el identificador de deploy de Vercel.
//
// Cerrar solo lo oculta hasta el próximo chequeo: si la pestaña sigue vieja,
// vuelve a aparecer.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

const CHECK_MS = 60_000;

export function VersionBanner() {
  const bootRef = useRef(null);
  const [show, setShow] = useState(false);

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/version", { cache: "no-store" });
      if (!r.ok) return;
      const { version } = await r.json();
      if (!version) return;
      if (bootRef.current == null) {
        bootRef.current = version;
        return;
      }
      if (version !== bootRef.current) setShow(true);
    } catch {
      // Sin red o endpoint caído: no es asunto de este aviso.
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, CHECK_MS);
    const onVis = () => !document.hidden && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [check]);

  if (!show) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        maxWidth: "min(720px, calc(100vw - 24px))",
        background: "var(--rl-primary-900, #0B3D5C)",
        color: "#fff",
        padding: "12px 14px 12px 16px",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,.28)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        font: "500 13px/1.45 var(--rl-font-body)",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "rgba(255,255,255,0.16)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="refresh" size={16} />
      </span>
      <span style={{ flex: 1 }}>
        <strong style={{ fontWeight: 700 }}>Hay una nueva versión disponible.</strong> Es importante
        actualizar la página para evitar errores en el uso de la app.
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          all: "unset",
          cursor: "pointer",
          background: "#fff",
          color: "var(--rl-primary-900, #0B3D5C)",
          padding: "8px 14px",
          borderRadius: 8,
          font: "700 12.5px/1 var(--rl-font-display)",
          whiteSpace: "nowrap",
        }}
      >
        Actualizar ahora
      </button>
      <button
        onClick={() => setShow(false)}
        aria-label="Cerrar"
        title="Cerrar (volverá a aparecer si sigue desactualizado)"
        style={{
          all: "unset",
          cursor: "pointer",
          width: 26,
          height: 26,
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.7,
        }}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
