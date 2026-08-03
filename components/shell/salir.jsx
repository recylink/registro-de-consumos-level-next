"use client";

// Botón de salir del pie del sidebar. Solo aparece si el sitio está tras
// contraseña (`conMuro` baja desde el layout, que es quien puede leer la env var).
//
// Existe porque la contraseña es compartida y el sitio se abre en computadores
// compartidos: sin esto la sesión dura una semana y no hay forma de cortarla.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { salirAction } from "@/app/actions/acceso";

export function SalirBtn({ collapsed }) {
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();

  return (
    <div style={{ padding: "8px", borderTop: "1px solid var(--rl-gray-200)" }}>
      <button
        className="rc-sidebar-item"
        style={{ width: "100%", background: "none", border: "none", cursor: "pointer", font: "inherit" }}
        data-tooltip="Salir"
        title={collapsed ? "Salir" : undefined}
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            await salirAction();
            // `refresh` para que el árbol cacheado del router no siga mostrando
            // pantallas a las que ya no se tiene acceso; el proxy manda al muro.
            router.replace("/acceso");
            router.refresh();
          })
        }
      >
        <span className="rc-sidebar-item-ico">
          <Icon name="lock" size={18} />
        </span>
        <span className="rc-sidebar-item-label">{pendiente ? "Saliendo…" : "Salir"}</span>
      </button>
    </div>
  );
}
