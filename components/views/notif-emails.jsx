"use client";

// Destinatarios del aviso "hay fotos por completar". Portado de la
// NotifEmailsSection de proto/config.jsx, donde agregar un email solo tocaba el
// reducer y la persistencia dependía del puente de sincronización; acá cada
// cambio se guarda al momento.

import { useState } from "react";
import { Btn, Input } from "@/components/ui/controls";
import { Card, Chip, Field, SectionHead } from "@/components/ui/layout";
import { useAccion } from "@/components/use-accion";
import { saveFotoNotifEmailsAction } from "@/app/actions/config";

const valido = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function NotifEmails({ emails }) {
  const { correr, pending } = useAccion();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const guardar = (lista, exito) =>
    correr(() => saveFotoNotifEmailsAction(lista), { exito, onExito: () => setDraft("") });

  const agregar = () => {
    const v = draft.trim();
    if (!v) return;
    if (!valido(v)) return setError("Email inválido.");
    if (emails.includes(v)) return setError("Ya está en la lista.");
    setError("");
    guardar([...emails, v], { title: "Destinatario agregado", body: v });
  };

  const quitar = (email) =>
    guardar(
      emails.filter((e) => e !== email),
      { title: "Destinatario eliminado", body: email },
    );

  return (
    <div style={{ marginTop: 28 }}>
      <SectionHead
        eyebrow="Notificaciones"
        title="Avisos de cola pendiente (Tomar foto)"
        sub="Cada vez que se suba una foto al módulo Tomar foto, estos destinatarios reciben un correo con los datos y el total pendiente."
      />
      <Card>
        <div className="prt-col" style={{ gap: 12 }}>
          <div className="prt-row" style={{ gap: 8, flexWrap: "wrap" }}>
            {emails.length === 0 && (
              <span className="prt-hint">Sin destinatarios — no se enviará correo.</span>
            )}
            {emails.map((e) => (
              <Chip key={e} kind="neutral" icon="mail" onClose={pending ? undefined : () => quitar(e)}>
                {e}
              </Chip>
            ))}
          </div>
          <div className="prt-row" style={{ gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field error={error}>
                <Input
                  value={draft}
                  onChange={(v) => {
                    setDraft(v);
                    if (error) setError("");
                  }}
                  placeholder="nombre@empresa.cl"
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      agregar();
                    }
                  }}
                />
              </Field>
            </div>
            <Btn kind="primary" icon="add" onClick={agregar} disabled={pending || !draft.trim()}>
              Agregar
            </Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
