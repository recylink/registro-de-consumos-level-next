"use client";

// Modal de gestión de medidores de una (sucursal, tipo): crear, renombrar,
// marcar como no facturable y desactivar. Portado de proto/medidores.jsx.

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Btn, Input } from "@/components/ui/controls";
import { Chip, Field } from "@/components/ui/layout";
import { useMedidores } from "@/components/medidores/estado";
import { MED_TYPES, medFacturable } from "@/lib/domain/medidores-calc";
import { metersFor, numeroDuplicado } from "@/lib/domain/medidores";

export function MedManageModal({ suc, type, onClose }) {
  const { M, addMeter, editMeter, toggleMeter } = useMedidores();
  const lista = metersFor(M, suc, type, true);

  const [nombre, setNombre] = useState("");
  const [numero, setNumero] = useState("");
  const [error, setError] = useState("");
  const [editId, setEditId] = useState(null);
  const [editNombre, setEditNombre] = useState("");
  const [editNumero, setEditNumero] = useState("");

  // Cierre con Esc, igual que el resto de los diálogos de la app.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const agregar = () => {
    const nom = nombre.trim();
    if (!nom) return setError("El nombre es obligatorio.");
    if (numeroDuplicado(lista, numero)) {
      return setError("Ya existe un medidor con ese número en esta sucursal.");
    }
    addMeter({ sucursal: suc, type, nombre: nom, numero });
    setNombre("");
    setNumero("");
    setError("");
  };

  const empezarEdicion = (m) => {
    setEditId(m.id);
    setEditNombre(m.nombre);
    setEditNumero(m.numero || "");
    setError("");
  };

  const guardarEdicion = () => {
    const nom = editNombre.trim();
    if (!nom) return setError("El nombre es obligatorio.");
    if (numeroDuplicado(lista, editNumero, editId)) {
      return setError("Ya existe un medidor con ese número en esta sucursal.");
    }
    editMeter(editId, { nombre: nom, numero: editNumero.trim() });
    setEditId(null);
    setError("");
  };

  return (
    <div className="rc-med-modal-backdrop" onClick={onClose}>
      <div
        className="rc-med-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Gestionar medidores"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rc-med-modal-head">
          <div>
            <div className="prt-eyebrow">
              {MED_TYPES[type] ? MED_TYPES[type].label : type} · {suc}
            </div>
            <h2 className="prt-h2" style={{ marginTop: 2 }}>
              Gestionar medidores
            </h2>
          </div>
          <button className="rc-med-modal-close" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="rc-med-modal-body">
          <div className="rc-med-addrow">
            <Field label="Nombre" required style={{ flex: 1, marginBottom: 0 }}>
              <Input value={nombre} onChange={setNombre} placeholder="Ej: Medidor bodega" />
            </Field>
            <Field label="Número" style={{ width: 150, marginBottom: 0 }}>
              <Input value={numero} onChange={setNumero} placeholder="Opcional" />
            </Field>
            <Btn kind="primary" icon="add" onClick={agregar} style={{ marginBottom: 1 }}>
              Agregar
            </Btn>
          </div>
          {error && (
            <div className="prt-help error" style={{ marginTop: 8 }}>
              <Icon name="error" size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="rc-med-list" style={{ marginTop: 16 }}>
            {lista.length === 0 && (
              <div className="prt-muted" style={{ padding: "8px 0" }}>
                Aún no hay medidores. Agrega el primero arriba.
              </div>
            )}
            {lista.map((m) => (
              <div key={m.id} className={"rc-med-list-item" + (m.activo ? "" : " inactive")}>
                {editId === m.id ? (
                  <>
                    <Input value={editNombre} onChange={setEditNombre} style={{ flex: 1 }} />
                    <Input value={editNumero} onChange={setEditNumero} placeholder="N°" style={{ width: 110 }} />
                    <Btn size="sm" kind="primary" icon="check" onClick={guardarEdicion}>
                      Guardar
                    </Btn>
                    <Btn size="sm" kind="ghost" onClick={() => setEditId(null)}>
                      Cancelar
                    </Btn>
                  </>
                ) : (
                  <>
                    <div className="rc-med-list-name">
                      <strong>{m.nombre}</strong>
                      {m.numero && <span className="rc-med-num">N° {m.numero}</span>}
                      {!m.activo && (
                        <Chip size="sm" kind="neutral">
                          Inactivo
                        </Chip>
                      )}
                      {!medFacturable(m) && (
                        <Chip size="sm" kind="warning">
                          No se factura
                        </Chip>
                      )}
                    </div>
                    <Btn size="sm" kind="ghost" icon="edit" onClick={() => empezarEdicion(m)}>
                      Editar
                    </Btn>
                    <Btn
                      size="sm"
                      kind="ghost"
                      icon={medFacturable(m) ? "money_off" : "payments"}
                      title={
                        medFacturable(m)
                          ? "Excluir del proceso de facturación"
                          : "Volver a incluir en facturación"
                      }
                      onClick={() => editMeter(m.id, { facturable: !medFacturable(m) })}
                    >
                      {medFacturable(m) ? "No facturar" : "Facturar"}
                    </Btn>
                    <Btn
                      size="sm"
                      kind="ghost"
                      icon={m.activo ? "close" : "check"}
                      onClick={() => toggleMeter(m.id)}
                    >
                      {m.activo ? "Desactivar" : "Reactivar"}
                    </Btn>
                  </>
                )}
              </div>
            ))}
          </div>

          <div
            className="prt-hint"
            style={{ fontSize: 12, marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}
          >
            <Icon name="info" size={14} />
            Desactivar no borra el historial: el medidor deja de aparecer en los meses futuros. Un
            medidor con "No facturar" sigue registrando lecturas, pero no suma al total calculado ni
            entra al proceso de facturación.
          </div>
        </div>
      </div>
    </div>
  );
}
