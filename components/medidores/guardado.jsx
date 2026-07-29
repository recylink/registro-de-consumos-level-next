"use client";

// Indicador de guardado del módulo Medidores.
//
// El guardado es automático y con debounce, así que sin señal visible el usuario
// no tiene forma de distinguir "ya está en la planilla" de "se perdió". Este chip
// hace observable la fase del provider y, si un guardado falló, ofrece el
// reintento a mano.

import { Icon } from "@/components/icons";
import { useMedidores } from "@/components/medidores/estado";

const hora = (ts) =>
  ts ? new Date(ts).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "";

export function IndicadorGuardado({ compact }) {
  const { estado, reintentar } = useMedidores();
  const { fase, ts, error } = estado;

  if (fase === "error") {
    return (
      <span className="rc-med-save error" role="alert">
        <Icon name="error" size={14} />
        <span>Sin guardar</span>
        <button type="button" className="rc-med-save-retry" onClick={reintentar} title={error || ""}>
          Reintentar
        </button>
      </span>
    );
  }

  if (fase === "guardando") {
    return (
      <span className="rc-med-save" role="status">
        <span className="prt-spinner" />
        <span>Guardando…</span>
      </span>
    );
  }

  if (fase === "pendiente") {
    return (
      <span className="rc-med-save pendiente" role="status">
        <Icon name="schedule" size={14} />
        <span>Cambios sin guardar</span>
      </span>
    );
  }

  if (fase === "guardado") {
    return (
      <span className="rc-med-save ok" role="status">
        <Icon name="cloud_done" size={14} />
        <span>{compact ? `Guardado ${hora(ts)}` : `Guardado en la planilla · ${hora(ts)}`}</span>
      </span>
    );
  }

  // fase "limpio": nada que guardar todavía. Se explica igual que el guardado es
  // automático, que es la duda que aparece antes de escribir el primer dato.
  return (
    <span className="rc-med-save" role="status">
      <Icon name="cloud" size={14} />
      <span>{compact ? "Guardado automático" : "Las lecturas se guardan solas"}</span>
    </span>
  );
}
