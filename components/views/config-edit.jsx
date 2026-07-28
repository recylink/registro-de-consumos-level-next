"use client";

// Editar (o crear) una sucursal. Portado de proto/config-edit.jsx.
//
// Los cuatro sub-formularios del original —electricidad, combustible, agua,
// refrigerantes— eran componentes separados que se diferenciaban solo en qué
// campos mostraban. Ahora usan el SubcatForm dirigido por tabla de
// components/ui/subcat-form.jsx, compartido con el wizard de puesta en marcha.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Btn, Input } from "@/components/ui/controls";
import { Card, Field, SectionHead } from "@/components/ui/layout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAccion } from "@/components/use-accion";
import { saveSucursalAction } from "@/app/actions/config";
import { SubcatForm, nuevaSubcat } from "@/components/ui/subcat-form";
import { ITEM_TYPES } from "@/lib/domain/sucursales";
import { nextSucId } from "@/lib/domain/ids";
import { ITEM_DEFS } from "@/lib/domain/opciones";

export function ConfigEdit({ sucursal, esNueva, nombresExistentes, registrosPorTipo }) {
  const router = useRouter();
  const { correr, pending } = useAccion();
  const [draft, setDraft] = useState(sucursal);
  const [errors, setErrors] = useState({});
  const [modal, setModal] = useState(null);

  const updateItem = (type, patch) =>
    setDraft((d) => ({ ...d, items: { ...d.items, [type]: { ...d.items[type], ...patch } } }));

  const toggleItem = (type) => {
    const item = draft.items[type];
    const patch = { activo: !item.activo };
    // Al activar un ítem sin subcategorías, se abre con una lista para llenar.
    if (!item.activo && item.subcats.length === 0) patch.subcats = [nuevaSubcat(type)];
    updateItem(type, patch);
  };

  const updateSubcat = (type, subId, patch) =>
    updateItem(type, {
      subcats: draft.items[type].subcats.map((sc) => (sc.id === subId ? { ...sc, ...patch } : sc)),
    });

  const quitarSubcat = (type, subId) => {
    const restantes = draft.items[type].subcats.filter((sc) => sc.id !== subId);
    // Sin subcategorías el ítem queda desactivado: un ítem activo y vacío no
    // significa nada.
    updateItem(type, restantes.length ? { subcats: restantes } : { activo: false, subcats: [] });
    setModal(null);
  };

  const pedirQuitarSubcat = (type, subId) => {
    const registros = registrosPorTipo[type] || 0;
    if (registros > 0) setModal({ tipo: "quitar-subcat", itemType: type, subId, registros });
    else quitarSubcat(type, subId);
  };

  const validar = () => {
    const e = {};
    const nombre = draft.nombre.trim();
    if (!nombre) e.nombre = "El nombre es requerido";
    else if (nombresExistentes.some((n) => n.toLowerCase() === nombre.toLowerCase())) {
      e.nombre = "Ya existe una sucursal con este nombre";
    }
    if (!ITEM_TYPES.some((t) => draft.items[t].activo)) {
      e._items = "Una sucursal debe tener al menos un ítem de consumo configurado";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const guardar = (renombrarDesde) => {
    setModal(null);
    // El id definitivo se genera acá, al guardar. Lleva timestamp y azar para que
    // dos personas creando una sucursal a la vez no generen el mismo y la
    // segunda pise a la primera (el upsert es por id).
    const suc = {
      ...draft,
      id: esNueva ? nextSucId() : draft.id,
      nombre: draft.nombre.trim(),
    };
    correr(() => saveSucursalAction(suc, { renombrarDesde }), {
      exito: {
        title: esNueva ? "Sucursal creada" : "Cambios guardados",
        body: `"${suc.nombre}" ${esNueva ? "fue creada" : "actualizada"} correctamente.`,
      },
      onExito: () => router.push("/configuracion"),
    });
  };

  const alGuardar = () => {
    if (!validar()) return;
    const nombreCambio = !esNueva && draft.nombre.trim() !== sucursal.nombre;
    if (nombreCambio) setModal({ tipo: "renombrar", desde: sucursal.nombre, hacia: draft.nombre.trim() });
    else guardar();
  };

  return (
    <div>
      <SectionHead
        eyebrow={
          esNueva
            ? "Configuración / Sucursales / Nueva"
            : `Configuración / Sucursales / ${sucursal.nombre}`
        }
        title={
          esNueva
            ? `Nueva sucursal${draft.nombre ? ": " + draft.nombre : ""}`
            : `Editar: ${draft.nombre || "Sin nombre"}`
        }
        right={
          <Btn icon="arrow_back" onClick={() => router.push("/configuracion")}>
            {esNueva ? "Cancelar" : "Volver a configuración"}
          </Btn>
        }
      />

      <Card style={{ marginBottom: 20 }}>
        <div className="prt-h4" style={{ marginBottom: 14 }}>Datos generales</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Nombre de la sucursal" required error={errors.nombre}>
            <Input
              value={draft.nombre}
              onChange={(v) => setDraft((d) => ({ ...d, nombre: v }))}
              placeholder="Ej: Planta Norte"
              error={!!errors.nombre}
            />
          </Field>
          <Field label="Dirección">
            <Input
              value={draft.direccion}
              onChange={(v) => setDraft((d) => ({ ...d, direccion: v }))}
              placeholder="Opcional"
            />
          </Field>
        </div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <div className="prt-h4" style={{ marginBottom: 4 }}>Ítems de consumo</div>
        <div className="prt-hint" style={{ marginBottom: 16 }}>
          Activa los consumos que quieres registrar y configura sus proveedores.
        </div>

        {errors._items && (
          <div className="prt-help error" style={{ justifyContent: "center", marginBottom: 14 }}>
            <Icon name="error" size={14} />
            <span>{errors._items}</span>
          </div>
        )}

        <div className="prt-stack-md">
          {ITEM_TYPES.map((type) => {
            const def = ITEM_DEFS[type];
            const item = draft.items[type];
            return (
              <div key={type} className={"ob-item-card" + (item.activo ? " active" : "")}>
                <div className="ob-item-head" onClick={() => toggleItem(type)}>
                  <span className="ob-item-ico" style={{ background: def.bg, color: def.color }}>
                    <Icon name={def.icon} size={20} />
                  </span>
                  <span className="ob-item-label">{def.label}</span>
                  <button
                    className={"ob-toggle" + (item.activo ? " active" : "")}
                    aria-label={(item.activo ? "Desactivar " : "Activar ") + def.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleItem(type);
                    }}
                  />
                </div>
                {item.activo && (
                  <div className="ob-item-body">
                    <SubcatForm
                      type={type}
                      item={item}
                      onUpdate={(subId, patch) => updateSubcat(type, subId, patch)}
                      onAdd={() => updateItem(type, { subcats: [...item.subcats, nuevaSubcat(type)] })}
                      onRemove={(subId) => pedirQuitarSubcat(type, subId)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingBottom: 80 }}>
        <Btn onClick={() => router.push("/configuracion")}>Cancelar</Btn>
        <Btn kind="primary" icon="check" onClick={alGuardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Btn>
      </div>

      {modal?.tipo === "renombrar" && (
        <ConfirmDialog
          icon="edit"
          iconBg="var(--rl-primary-50)"
          iconColor="var(--rl-primary-900)"
          title="Nombre de sucursal modificado"
          description={`Cambiaste el nombre de "${modal.desde}" a "${modal.hacia}". ¿Quieres actualizar también los registros históricos con este nuevo nombre?`}
          detail="Los registros guardan el nombre de la sucursal como texto. Si no se actualizan, el historial anterior queda asociado al nombre viejo."
          onClose={() => setModal(null)}
          actions={
            <>
              <Btn onClick={() => guardar()}>No, solo desde ahora</Btn>
              <Btn kind="primary" onClick={() => guardar(modal.desde)}>Sí, actualizar todo</Btn>
            </>
          }
        />
      )}

      {modal?.tipo === "quitar-subcat" && (
        <ConfirmDialog
          icon="warning"
          iconBg="var(--rl-warning-50)"
          iconColor="var(--rl-warning-600)"
          title="Este ítem tiene consumos registrados"
          description={`Hay ${modal.registros} registros de este tipo en la sucursal. Quitar la subcategoría cambia la configuración, no el historial: los registros se mantienen y siguen contando en el dashboard y en la huella.`}
          onClose={() => setModal(null)}
          actions={
            <>
              <Btn onClick={() => setModal(null)}>Cancelar</Btn>
              <Btn kind="danger" icon="delete" onClick={() => quitarSubcat(modal.itemType, modal.subId)}>
                Quitar subcategoría
              </Btn>
            </>
          }
        />
      )}
    </div>
  );
}
