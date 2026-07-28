"use client";

// Puesta en marcha: wizard de tres pasos —sucursales, ítems, resumen— portado de
// proto/onboarding{,-items,-summary}.jsx.
//
// Los cuatro formularios de subcategorías del paso 2 eran componentes propios
// duplicados de los de la edición de sucursal; ahora ambos usan el mismo
// SubcatForm dirigido por tabla.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Btn, Input } from "@/components/ui/controls";
import { Card, Chip, Field, SectionHead, Steps } from "@/components/ui/layout";
import { SubcatForm, nuevaSubcat } from "@/components/ui/subcat-form";
import { useAccion } from "@/components/use-accion";
import { saveSucursalesAction } from "@/app/actions/config";
import { emptyItems, ITEM_TYPES } from "@/lib/domain/sucursales";
import { nextSucId } from "@/lib/domain/ids";
import {
  ITEM_DEFS, OTRO, proveedorDisplay, sistemaLabel, tipoAguaLabel, tipoCombLabel,
  tipoRefriLabel, unidadLabel, usoLabel,
} from "@/lib/domain/opciones";

const PASOS = ["Sucursales", "Ítems a registrar", "Resumen"];

const META_PASO = [
  { title: "Sucursales", sub: "Agrega las ubicaciones donde se registrarán consumos." },
  {
    title: "Ítems a registrar",
    sub: "Activa los consumos que quieres registrar en cada sucursal y configura sus proveedores.",
  },
  { title: "Resumen del proyecto", sub: "Revisa que todo esté correcto antes de crear el proyecto." },
];

const nuevaSucursal = () => ({ id: nextSucId(), nombre: "", direccion: "", items: emptyItems() });

// ---- Paso 1 ----------------------------------------------------------------

function PasoSucursales({ sucursales, setSucursales, errors }) {
  const update = (id, patch) =>
    setSucursales((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  return (
    <div className="prt-stack-md">
      {sucursales.map((s, i) => (
        <div key={s.id} className="ob-suc-card">
          <div className="ob-suc-card-head">
            <span className="ob-suc-num">{i + 1}</span>
            <span className="prt-h4" style={{ flex: 1 }}>{s.nombre || "Sucursal " + (i + 1)}</span>
            {sucursales.length > 1 && (
              <button
                className="ob-icon-btn rc-icon-hover"
                onClick={() => setSucursales((ss) => ss.filter((x) => x.id !== s.id))}
                title="Eliminar sucursal"
              >
                <Icon name="delete" size={16} />
              </button>
            )}
          </div>
          <div className="ob-suc-card-body">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Nombre" required error={errors["suc_" + s.id]}>
                <Input
                  value={s.nombre}
                  onChange={(v) => update(s.id, { nombre: v })}
                  placeholder="Ej: Planta Norte"
                  error={!!errors["suc_" + s.id]}
                />
              </Field>
              <Field label="Dirección">
                <Input
                  value={s.direccion}
                  onChange={(v) => update(s.id, { direccion: v })}
                  placeholder="Opcional"
                />
              </Field>
            </div>
          </div>
        </div>
      ))}
      <button className="ob-add-btn" onClick={() => setSucursales((ss) => [...ss, nuevaSucursal()])}>
        <Icon name="add" size={18} />
        <span>Agregar sucursal</span>
      </button>
    </div>
  );
}

// ---- Paso 2 ----------------------------------------------------------------

function PasoItems({ sucursales, setSucursales }) {
  const [activa, setActiva] = useState(sucursales[0]?.id || "");
  const suc = sucursales.find((s) => s.id === activa) || sucursales[0];
  if (!suc) return null;

  const updateItem = (type, patch) =>
    setSucursales((ss) =>
      ss.map((s) =>
        s.id !== suc.id ? s : { ...s, items: { ...s.items, [type]: { ...s.items[type], ...patch } } },
      ),
    );

  const toggle = (type) => {
    const item = suc.items[type];
    const patch = { activo: !item.activo };
    if (!item.activo && item.subcats.length === 0) patch.subcats = [nuevaSubcat(type)];
    updateItem(type, patch);
  };

  return (
    <div className="prt-stack-lg">
      {sucursales.length > 1 && (
        <div className="ob-suc-tabs">
          {sucursales.map((s) => {
            const n = ITEM_TYPES.filter((t) => s.items[t].activo).length;
            return (
              <button
                key={s.id}
                className={"ob-suc-tab" + (s.id === activa ? " active" : "")}
                onClick={() => setActiva(s.id)}
              >
                <span>{s.nombre || "Sin nombre"}</span>
                {n > 0 && <span className="ob-suc-tab-badge">{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="prt-stack-md">
        {ITEM_TYPES.map((type) => {
          const def = ITEM_DEFS[type];
          const item = suc.items[type];
          return (
            <div key={type} className={"ob-item-card" + (item.activo ? " active" : "")}>
              <div className="ob-item-head" onClick={() => toggle(type)}>
                <span className="ob-item-ico" style={{ background: def.bg, color: def.color }}>
                  <Icon name={def.icon} size={20} />
                </span>
                <span className="ob-item-label">{def.label}</span>
                <button
                  className={"ob-toggle" + (item.activo ? " active" : "")}
                  aria-label={(item.activo ? "Desactivar " : "Activar ") + def.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(type);
                  }}
                />
              </div>
              {item.activo && (
                <div className="ob-item-body">
                  <SubcatForm
                    type={type}
                    item={item}
                    onUpdate={(subId, patch) =>
                      updateItem(type, {
                        subcats: item.subcats.map((sc) => (sc.id === subId ? { ...sc, ...patch } : sc)),
                      })
                    }
                    onAdd={() => updateItem(type, { subcats: [...item.subcats, nuevaSubcat(type)] })}
                    onRemove={(subId) =>
                      updateItem(type, { subcats: item.subcats.filter((sc) => sc.id !== subId) })
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Paso 3 ----------------------------------------------------------------

function etiquetaSubcat(type, sc) {
  if (type === "electricidad") return sistemaLabel(sc.sistemaElectrico) || "Sin sistema";
  if (type === "combustible") {
    return (
      (tipoCombLabel(sc.tipo, sc.tipoCustom) || "Sin tipo") +
      (sc.uso ? " · " + usoLabel(sc.uso) : "") +
      (sc.unidad ? " · " + unidadLabel(sc.unidad) : "")
    );
  }
  if (type === "agua") return tipoAguaLabel(sc.tipo, sc.tipoCustom) || "Sin tipo";
  return sc.tipo === OTRO ? sc.tipoCustom || "Otro" : tipoRefriLabel(sc.tipo) || "Sin tipo";
}

function PasoResumen({ sucursales }) {
  const conItems = sucursales.filter((s) => ITEM_TYPES.some((t) => s.items[t].activo));

  if (conItems.length === 0) {
    return <div className="rc-todo">Ninguna sucursal tiene ítems activos todavía.</div>;
  }

  return (
    <div className="prt-stack-lg">
      {conItems.map((suc) => {
        const activos = ITEM_TYPES.filter((t) => suc.items[t].activo);
        return (
          <Card key={suc.id}>
            <div className="ob-summary-suc-head">
              <div>
                <div className="prt-h4">{suc.nombre || "Sin nombre"}</div>
                {suc.direccion && (
                  <div className="prt-hint" style={{ marginTop: 2 }}>{suc.direccion}</div>
                )}
              </div>
              <Chip size="sm">
                {activos.length} ítem{activos.length !== 1 ? "s" : ""}
              </Chip>
            </div>
            <div className="ob-summary-items">
              {activos.map((type) => {
                const def = ITEM_DEFS[type];
                const subcats = suc.items[type].subcats || [];
                return (
                  <div key={type} className="ob-summary-item">
                    <div className="ob-summary-item-head">
                      <span className="ob-item-ico sm" style={{ background: def.bg, color: def.color }}>
                        <Icon name={def.icon} size={16} />
                      </span>
                      <span style={{ font: "600 14px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>
                        {def.label}
                      </span>
                      <span className="prt-hint" style={{ marginLeft: "auto" }}>
                        {subcats.length} subcategoría{subcats.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {subcats.length > 0 && (
                      <div className="ob-summary-subcats">
                        {subcats.map((sc) => (
                          <div key={sc.id} className="ob-summary-subcat-row">
                            <span className="ob-summary-subcat-label">{etiquetaSubcat(type, sc)}</span>
                            <span className="prt-hint" style={{ flex: 1 }}>
                              {proveedorDisplay(sc.proveedor, sc.proveedorCustom)}
                            </span>
                            {type !== "refrigerantes" &&
                              (sc.numCliente ? (
                                <Chip kind="success" size="sm">
                                  <Icon name="check" size={12} /> N° cliente
                                </Chip>
                              ) : (
                                <Chip size="sm">Sin N° cliente</Chip>
                              ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---- Wizard ----------------------------------------------------------------

export function Onboarding() {
  const router = useRouter();
  const { correr, pending } = useAccion();
  const [paso, setPaso] = useState(0);
  const [sucursales, setSucursales] = useState([nuevaSucursal()]);
  const [errors, setErrors] = useState({});

  const validar = () => {
    const e = {};
    if (paso === 0) {
      for (const s of sucursales) if (!s.nombre.trim()) e["suc_" + s.id] = "Requerido";
    }
    if (paso === 1 && !sucursales.some((s) => ITEM_TYPES.some((t) => s.items[t].activo))) {
      e._items = "Activa al menos un ítem en alguna sucursal";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const crear = () => {
    const listas = sucursales.map((s) => ({ ...s, nombre: s.nombre.trim(), activa: true }));
    correr(() => saveSucursalesAction(listas), {
      exito: {
        title: "Proyecto creado con éxito",
        body: `${listas.length} sucursal${listas.length !== 1 ? "es" : ""} configurada${listas.length !== 1 ? "s" : ""}.`,
      },
      onExito: () => router.push("/"),
    });
  };

  return (
    <div className="ob-wizard">
      <Steps items={PASOS} current={paso} />
      <SectionHead title={META_PASO[paso].title} sub={META_PASO[paso].sub} />
      <div className="ob-body">
        {paso === 0 && (
          <PasoSucursales sucursales={sucursales} setSucursales={setSucursales} errors={errors} />
        )}
        {paso === 1 && <PasoItems sucursales={sucursales} setSucursales={setSucursales} />}
        {paso === 2 && <PasoResumen sucursales={sucursales} />}
      </div>

      {errors._items && (
        <div className="prt-help error" style={{ justifyContent: "center" }}>
          <Icon name="error" size={14} />
          <span>{errors._items}</span>
        </div>
      )}

      <div className="ob-footer">
        {paso > 0 ? (
          <Btn
            icon="arrow_back"
            onClick={() => {
              setErrors({});
              setPaso((p) => p - 1);
            }}
          >
            Atrás
          </Btn>
        ) : (
          <div />
        )}
        <div style={{ flex: 1 }} />
        {paso < 2 ? (
          <Btn kind="primary" iconRight="arrow_forward" onClick={() => validar() && setPaso((p) => p + 1)}>
            Siguiente
          </Btn>
        ) : (
          <Btn kind="primary" icon="check" onClick={crear} disabled={pending}>
            {pending ? "Creando…" : "Crear proyecto"}
          </Btn>
        )}
      </div>
    </div>
  );
}
