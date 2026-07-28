"use client";

// Formulario de subcategorías de un tipo de consumo, dirigido por tabla.
//
// El prototipo tenía OCHO componentes casi idénticos para esto: cuatro en
// config-edit.jsx (ConfigElecForm, ConfigCombForm, ConfigAguaForm,
// ConfigRefriForm) y otros cuatro en onboarding-items.jsx (ObElectricidadForm,
// ObCombustibleForm, ObAguaForm, ObRefrigerantesForm), ~35 líneas cada uno y
// diferenciados solo por qué campos mostraban. Acá los campos son la tabla CAMPOS
// y hay un único formulario que la recorre, compartido por la edición de sucursal
// y por el wizard de puesta en marcha.

import { Icon } from "@/components/icons";
import { Input, Select } from "@/components/ui/controls";
import { Field } from "@/components/ui/layout";
import { nextItemId } from "@/lib/domain/ids";
import {
  OTRO, SISTEMAS, TIPOS_AGUA, TIPOS_COMBUSTIBLE, TIPOS_REFRIGERANTE,
  USOS_COMBUSTIBLE, fuelDefaultUnit, fuelUnitsForTipo, providerOpts,
} from "@/lib/domain/opciones";

// Campo con ayuda contextual: el original mostraba un tooltip con un icono de
// info junto a la etiqueta.
function EtiquetaConAyuda({ children, ayuda, requerido }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {children}
      {requerido && <span className="req">*</span>}
      <span className="ob-tooltip-wrap">
        <Icon name="info" size={13} style={{ color: "var(--rl-gray-400)" }} />
        <span className="ob-tooltip">{ayuda}</span>
      </span>
    </span>
  );
}

const CAMPO_NUM_CLIENTE = {
  key: "numCliente",
  tipo: "texto",
  label: "N° de cliente",
  helper: "Match automático con facturas",
  placeholder: "Opcional",
};

const campoProveedor = (type, placeholder = "Seleccionar…") => [
  { key: "proveedor", tipo: "select", label: "Proveedor", opciones: providerOpts(type), placeholder },
  {
    key: "proveedorCustom",
    tipo: "texto",
    label: "Nombre del proveedor",
    placeholder: "Ingresa el nombre…",
    soloSi: (sc) => sc.proveedor === OTRO,
  },
];

// Campos de cada tipo de consumo, en orden de aparición.
export const CAMPOS = {
  electricidad: [
    {
      key: "sistemaElectrico",
      tipo: "select",
      label: <EtiquetaConAyuda ayuda="Determina el factor de emisión" requerido>Sistema eléctrico</EtiquetaConAyuda>,
      opciones: SISTEMAS,
    },
    ...campoProveedor("electricidad"),
    CAMPO_NUM_CLIENTE,
  ],
  combustible: [
    {
      key: "tipo",
      tipo: "select",
      label: "Tipo",
      requerido: true,
      // Con el tipo llega su unidad por defecto, para no obligar a elegirla.
      alCambiar: (v) => {
        const u = fuelDefaultUnit(v);
        return u ? { tipo: v, unidad: u } : { tipo: v };
      },
      opciones: TIPOS_COMBUSTIBLE.map((t) => ({
        value: t.value,
        label: t.defaultUnit ? `${t.label} · ${t.defaultUnit}` : t.label,
      })),
    },
    {
      key: "tipoCustom",
      tipo: "texto",
      label: "Nombre del combustible",
      placeholder: "Ej: Biogás",
      soloSi: (sc) => sc.tipo === OTRO,
    },
    {
      key: "uso",
      tipo: "select",
      label: <EtiquetaConAyuda ayuda="Afecta el factor de emisión" requerido>Uso</EtiquetaConAyuda>,
      opciones: USOS_COMBUSTIBLE,
    },
    {
      key: "unidad",
      tipo: "select",
      label: (sc) =>
        sc.tipo && fuelDefaultUnit(sc.tipo) ? (
          <span>
            Unidad de medida{" "}
            <span className="prt-hint" style={{ fontWeight: 400 }}>
              (pred: {fuelDefaultUnit(sc.tipo)})
            </span>
          </span>
        ) : (
          "Unidad de medida"
        ),
      opciones: (sc) => fuelUnitsForTipo(sc.tipo),
    },
    ...campoProveedor("combustible"),
    CAMPO_NUM_CLIENTE,
  ],
  agua: [
    { key: "tipo", tipo: "select", label: "Tipo de agua", requerido: true, opciones: TIPOS_AGUA },
    {
      key: "tipoCustom",
      tipo: "texto",
      label: "Nombre del tipo",
      placeholder: "Ej: Riego",
      soloSi: (sc) => sc.tipo === OTRO,
    },
    ...campoProveedor("agua"),
    CAMPO_NUM_CLIENTE,
  ],
  refrigerantes: [
    {
      key: "tipo",
      tipo: "select",
      label: "Tipo de refrigerante",
      requerido: true,
      opciones: TIPOS_REFRIGERANTE,
    },
    {
      key: "tipoCustom",
      tipo: "texto",
      label: "Nombre del refrigerante",
      placeholder: "Ej: R-32",
      soloSi: (sc) => sc.tipo === OTRO,
    },
    ...campoProveedor("refrigerantes", "Opcional"),
  ],
};

// Subcategoría vacía: las claves salen de los campos del tipo, así agregar un
// campo a CAMPOS no obliga a tocar otra función.
export function nuevaSubcat(type) {
  const sc = { id: nextItemId() };
  for (const c of CAMPOS[type]) sc[c.key] = "";
  return sc;
}

const valor = (v, sc) => (typeof v === "function" ? v(sc) : v);

export function SubcatForm({ type, item, onUpdate, onAdd, onRemove }) {
  return (
    <div className="prt-stack-md">
      {item.subcats.map((sc, i) => (
        <div key={sc.id} className="ob-subcat-block">
          <div className="ob-subcat-head">
            <span className="prt-hint" style={{ fontWeight: 700 }}>Subcategoría {i + 1}</span>
            {item.subcats.length > 1 && (
              <button className="ob-icon-btn sm" onClick={() => onRemove(sc.id)} title="Eliminar">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {CAMPOS[type]
              .filter((c) => !c.soloSi || c.soloSi(sc))
              .map((c) => (
                <Field key={c.key} label={valor(c.label, sc)} required={c.requerido} helper={c.helper}>
                  {c.tipo === "select" ? (
                    <Select
                      value={sc[c.key] || ""}
                      onChange={(v) => onUpdate(sc.id, c.alCambiar ? c.alCambiar(v) : { [c.key]: v })}
                      options={valor(c.opciones, sc)}
                      placeholder={c.placeholder || "Seleccionar…"}
                    />
                  ) : (
                    <Input
                      value={sc[c.key] || ""}
                      onChange={(v) => onUpdate(sc.id, { [c.key]: v })}
                      placeholder={c.placeholder}
                    />
                  )}
                </Field>
              ))}
          </div>
        </div>
      ))}
      <button className="ob-add-btn sm" onClick={onAdd}>
        <Icon name="add" size={16} />
        <span>Agregar subcategoría</span>
      </button>
    </div>
  );
}
