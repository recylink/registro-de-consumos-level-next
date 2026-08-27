"use client";

// Formulario del muro de contraseña.
//
// Reusa las clases `.rc-auth-*` de app/styles/rc-auth.css, que ya estaban
// importadas en globals.css y no las usaba nadie: quedaron del gate de Google del
// prototipo.
//
// La contraseña se manda a un Server Action y se compara en el servidor. Este
// componente no la conoce ni la puede conocer: `SITE_PASSWORD` no lleva prefijo
// NEXT_PUBLIC_, así que no existe en el bundle del navegador.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Btn } from "@/components/ui/controls";
import { Field } from "@/components/ui/layout";
import { ingresarAction } from "@/app/actions/acceso";

export function FormAcceso({ destino }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [verla, setVerla] = useState(false);
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();

  function enviar(e) {
    e.preventDefault();
    if (!password || pendiente) return;
    setError(null);
    iniciar(async () => {
      const fd = new FormData();
      fd.set("password", password);
      const res = await ingresarAction(fd);
      if (res.ok) {
        // `refresh` además de `replace`: el proxy ya dejó pasar, pero el árbol
        // renderizado del muro sigue en caché del router y volvería a mostrarse.
        router.replace(destino);
        router.refresh();
        return;
      }
      setError(res.error || "No se pudo ingresar.");
      setPassword("");
    });
  }

  return (
    <div className="rc-auth-overlay">
      <form className="rc-auth-card" onSubmit={enviar}>
        <div className="rc-auth-logo">
          <Icon name="lock" size={26} />
        </div>

        <h1 style={{ font: "700 22px/1.25 var(--rl-font-display)", margin: "0 0 6px" }}>
          Registro de Consumos
        </h1>
        <p
          style={{
            font: "400 14px/1.5 var(--rl-font-ui)",
            color: "var(--rl-gray-600)",
            margin: "0 0 22px",
          }}
        >
          Este sitio es privado. Ingresa la contraseña para continuar.
        </p>

        <Field label="Contraseña" error={error}>
          <div className="prt-input-wrap has-suffix">
            <input
              className={"prt-input" + (error ? " error" : "")}
              type={verla ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              // El navegador puede ofrecer guardarla; es una contraseña compartida
              // de sitio, no personal, y es lo que se espera de un muro así.
              name="password"
              disabled={pendiente}
            />
            <button
              type="button"
              className="prt-suffix"
              onClick={() => setVerla((v) => !v)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              title={verla ? "Ocultar" : "Mostrar"}
              aria-label={verla ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              <Icon name={verla ? "eye_off" : "eye"} size={16} />
            </button>
          </div>
        </Field>

        <div style={{ marginTop: 18 }}>
          <Btn
            kind="primary"
            type="submit"
            disabled={!password || pendiente}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {pendiente ? "Verificando…" : "Ingresar"}
          </Btn>
        </div>
      </form>
    </div>
  );
}
