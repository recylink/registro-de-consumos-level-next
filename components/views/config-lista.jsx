"use client";

// Lista de sucursales configuradas. Portado de proto/config.jsx.
//
// Diferencia de fondo: antes activar/desactivar solo cambiaba el reducer y la
// escritura al Sheet ocurría después, por diffing en un puente aparte. Acá el
// toggle llama al Server Action y hasta que responde el control queda
// deshabilitado, así el usuario sabe si quedó guardado.

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Btn } from "@/components/ui/controls";
import { Chip, SectionHead } from "@/components/ui/layout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAccion } from "@/components/use-accion";
import { deleteSucursalAction, saveSucursalAction } from "@/app/actions/config";
import { ITEM_TYPES } from "@/lib/domain/sucursales";
import { sistemaLabel } from "@/lib/domain/opciones";

const contarItems = (suc) => ITEM_TYPES.filter((t) => suc.items?.[t]?.activo).length;

function sistemasDe(suc) {
  const elec = suc.items?.electricidad;
  if (!elec?.activo || !elec.subcats.length) return "—";
  const sistemas = [...new Set(elec.subcats.map((sc) => sc.sistemaElectrico).filter(Boolean))];
  return sistemas.map(sistemaLabel).join(", ") || "—";
}

export function ConfigLista({ sucursales, registrosPorSucursal }) {
  const { correr, pending } = useAccion();
  const [modal, setModal] = useState(null); // { tipo, suc, registros }

  const activar = (suc) =>
    correr(() => saveSucursalAction({ ...suc, activa: true }), {
      exito: {
        title: "Sucursal activada",
        body: `"${suc.nombre}" está disponible para registrar consumos.`,
      },
    });

  const desactivar = () => {
    const suc = modal.suc;
    setModal(null);
    correr(() => saveSucursalAction({ ...suc, activa: false }), {
      exito: {
        title: "Sucursal desactivada",
        body: `"${suc.nombre}" ya no aparecerá al registrar consumos.`,
      },
    });
  };

  const eliminar = () => {
    const suc = modal.suc;
    setModal(null);
    correr(() => deleteSucursalAction(suc.id), {
      exito: { title: "Sucursal eliminada", body: `"${suc.nombre}" fue eliminada.` },
    });
  };

  return (
    <div>
      <SectionHead
        eyebrow="Configuración / Sucursales"
        title="Sucursales configuradas"
        right={
          <>
            <Link className="prt-btn primary" href="/configuracion/nueva">
              <Icon name="add" />
              Agregar sucursal
            </Link>
            <Link className="prt-btn" href="/dashboard">
              <Icon name="arrow_back" />
              Volver al dashboard
            </Link>
          </>
        }
      />

      <div className="prt-stack-md" style={{ marginBottom: 20 }}>
        {sucursales.length === 0 && (
          <div className="rc-todo">
            Todavía no hay sucursales. Agrega la primera, o usa la{" "}
            <Link href="/onboarding">puesta en marcha</Link> para cargar varias de una vez.
          </div>
        )}
        {sucursales.map((suc) => {
          const items = contarItems(suc);
          return (
            <div key={suc.id} className={"cfg-suc-card" + (!suc.activa ? " inactive" : "")}>
              <div className="cfg-suc-row">
                <div className="cfg-suc-info">
                  <div className="cfg-suc-name">{suc.nombre}</div>
                  {suc.direccion && (
                    <div className="prt-hint" style={{ marginTop: 1 }}>{suc.direccion}</div>
                  )}
                </div>
                <Chip kind={suc.activa ? "success" : "neutral"} size="sm">
                  {suc.activa ? "Activa" : "Inactiva"}
                </Chip>
                <div className="cfg-suc-meta">
                  <span className="cfg-meta-pill">
                    <Icon name="checklist" size={14} />
                    {items} ítem{items !== 1 ? "s" : ""}
                  </span>
                  <span className="cfg-meta-pill">
                    <Icon name="bolt" size={14} />
                    {sistemasDe(suc)}
                  </span>
                </div>
                <div className="cfg-suc-actions">
                  <Link className="prt-btn sm" href={`/configuracion/${suc.id}`}>
                    <Icon name="edit" />
                    Editar
                  </Link>
                  <button
                    className={"cfg-toggle-btn" + (suc.activa ? " active" : "")}
                    disabled={pending}
                    onClick={() =>
                      suc.activa ? setModal({ tipo: "desactivar", suc }) : activar(suc)
                    }
                    title={suc.activa ? "Desactivar sucursal" : "Activar sucursal"}
                  >
                    <span className="cfg-toggle-track">
                      <span className="cfg-toggle-thumb" />
                    </span>
                    <span className="cfg-toggle-label">
                      {suc.activa ? "Activada" : "Desactivada"}
                    </span>
                  </button>
                  <Btn
                    size="sm"
                    kind="danger"
                    icon="delete"
                    disabled={pending}
                    onClick={() =>
                      setModal({
                        tipo: "eliminar",
                        suc,
                        registros: registrosPorSucursal[suc.nombre] || 0,
                      })
                    }
                  >
                    Eliminar
                  </Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal?.tipo === "desactivar" && (
        <ConfirmDialog
          icon="toggle_off"
          iconBg="var(--rl-warning-50)"
          iconColor="var(--rl-warning-600)"
          title="¿Desactivar esta sucursal?"
          description="Al desactivar esta sucursal ya no aparecerá como opción al registrar consumos, pero su historial se mantiene. ¿Confirmas?"
          onClose={() => setModal(null)}
          actions={
            <>
              <Btn onClick={() => setModal(null)}>Cancelar</Btn>
              <Btn kind="primary" onClick={desactivar}>Sí, desactivar</Btn>
            </>
          }
        />
      )}

      {modal?.tipo === "eliminar" && (
        <ConfirmDialog
          icon="delete"
          iconBg="var(--rl-error-50)"
          iconColor="var(--rl-error-500)"
          title="¿Eliminar esta sucursal?"
          description={
            modal.registros > 0
              ? `"${modal.suc.nombre}" tiene ${modal.registros} registros históricos. Se eliminará la configuración pero los registros se mantendrán.`
              : `"${modal.suc.nombre}" no tiene registros. Se eliminará completamente.`
          }
          onClose={() => setModal(null)}
          actions={
            <>
              <Btn onClick={() => setModal(null)}>Cancelar</Btn>
              <Btn kind="danger" icon="delete" onClick={eliminar}>Eliminar sucursal</Btn>
            </>
          }
        />
      )}
    </div>
  );
}
