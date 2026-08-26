"use client";

// Módulo Medidores. Portado de proto/medidores.jsx.
//
// Registra lecturas físicas por medidor (electricidad / combustible / agua),
// calcula consumo (diferencia entre lecturas) y costo (consumo × precio
// unitario), y los compara con el consumo global ya registrado (Total boleta).
//
// La selección (sucursal, tipo, pestaña, período) es estado de esta pantalla; el
// dato editable vive en MedidoresProvider, que además lo guarda. En el prototipo
// las dos cosas estaban juntas en el reducer global, así que qué sucursal
// mirabas era parte del documento que se sincronizaba.

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Btn, Select } from "@/components/ui/controls";
import { EmptyState, SectionHead } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { MedidoresProvider, useMedidores } from "@/components/medidores/estado";
import { IndicadorGuardado } from "@/components/medidores/guardado";
import { MedManageModal } from "@/components/medidores/gestionar";
import { ResumenTab } from "@/components/medidores/resumen";
import { MatrizTab, MensualTab, PagosTab } from "@/components/medidores/tablas";
import { exportMedidoresExcelAction } from "@/app/actions/medidores";
import { monthLabelShort } from "@/lib/domain/format";
import { MED_TYPE_OPTS, metersFor } from "@/lib/domain/medidores";
import { MED_TYPES } from "@/lib/domain/medidores-calc";
import { parseCustomPeriod, periodLabel, periodToMonthKeys } from "@/lib/domain/periods";
import { activeSucNames } from "@/lib/domain/sucursales";
import { descargarBase64 } from "@/lib/descargar";

const TABS = [
  { id: "resumen", label: "Resumen", icon: "dashboard" },
  { id: "matriz", label: "Matriz", icon: "table_view" },
  { id: "mensual", label: "Mensual", icon: "calendar_today" },
  { id: "pagos", label: "Pagos", icon: "payments" },
];

const PERIOD_OPTS = [
  { value: "12m", label: "Últimos 12 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "3m", label: "Últimos 3 meses" },
  { value: "1m", label: "Mes actual" },
  { value: "custom", label: "Personalizado" },
];

function MedTabs({ value, onChange }) {
  return (
    <div className="rc-med-tabs" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={"rc-med-tab" + (value === t.id ? " active" : "")}
          onClick={() => onChange(t.id)}
        >
          <Icon name={t.icon} size={16} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Filtros: sucursal y tipo siempre; período o mes según la pestaña. */
function MedToolbar({ sel, setSel, sucursales, meses, mesActual }) {
  const nombres = activeSucNames(sucursales);
  const custom = parseCustomPeriod(sel.period);
  // Meses en orden descendente: el mes actual arriba, que es el que se registra.
  const opcionesMes = meses
    .slice()
    .reverse()
    .map((mk) => ({ value: mk, label: monthLabelShort(mk) }));

  const cambiarPeriodo = (v) =>
    setSel({ period: v === "custom" ? `custom:${meses[meses.length - 3]}:${mesActual}` : v });

  const setRango = (patch) => {
    const r = { start: custom?.start || meses[meses.length - 3], end: custom?.end || mesActual, ...patch };
    setSel({ period: `custom:${r.start}:${r.end}` });
  };

  const idxMes = meses.indexOf(sel.mensualMonth);
  const moverMes = (dir) => {
    const ni = idxMes + dir;
    if (ni < 0 || ni >= meses.length) return;
    setSel({ mensualMonth: meses[ni] });
  };

  return (
    <div className="rc-med-toolbar">
      <div className="rc-med-toolbar-left">
        <div className="rc-med-tb-group">
          <Select
            size="sm"
            value={sel.sucursal}
            placeholder="Sucursal"
            style={{ minWidth: 160 }}
            options={nombres.map((n) => ({ value: n, label: n }))}
            onChange={(v) => setSel({ sucursal: v })}
          />
          <Select
            size="sm"
            value={sel.type}
            placeholder="Tipo"
            style={{ minWidth: 150 }}
            options={MED_TYPE_OPTS}
            onChange={(v) => setSel({ type: v })}
          />
        </div>

        <span className="rc-med-tb-divider" aria-hidden="true" />

        <div className="rc-med-tb-group">
          {sel.tab === "mensual" ? (
            <div className="rc-med-monthnav">
              <button
                className="rc-med-navbtn"
                title="Mes anterior"
                disabled={idxMes <= 0}
                onClick={() => moverMes(-1)}
              >
                <Icon name="chevron_left" size={16} />
              </button>
              <Select
                size="sm"
                value={sel.mensualMonth}
                style={{ minWidth: 132 }}
                options={opcionesMes}
                onChange={(v) => setSel({ mensualMonth: v })}
              />
              <button
                className="rc-med-navbtn"
                title="Mes siguiente"
                disabled={idxMes >= meses.length - 1}
                onClick={() => moverMes(1)}
              >
                <Icon name="chevron_right" size={16} />
              </button>
            </div>
          ) : (
            <>
              <Select
                size="sm"
                value={custom ? "custom" : sel.period}
                style={{ minWidth: 160 }}
                options={PERIOD_OPTS}
                onChange={cambiarPeriodo}
              />
              {custom && (
                <>
                  <Select
                    size="sm"
                    value={custom.start}
                    style={{ minWidth: 108 }}
                    options={opcionesMes}
                    onChange={(v) => setRango({ start: v })}
                  />
                  <span className="rc-med-tb-label">—</span>
                  <Select
                    size="sm"
                    value={custom.end}
                    style={{ minWidth: 108 }}
                    options={opcionesMes}
                    onChange={(v) => setRango({ end: v })}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Botón de export a Excel. El archivo se arma en el servidor, con xlsx. */
function BotonExcel({ sucursal, type, meses }) {
  const { M, guardando } = useMedidores();
  const toast = useToast();
  const [generando, setGenerando] = useState(false);

  const exportar = async () => {
    setGenerando(true);
    const res = await exportMedidoresExcelAction({ M, sucursal, tipo: type, meses });
    setGenerando(false);
    if (!res?.ok) {
      toast.error("No se pudo exportar", res?.error || "Error inesperado");
      return;
    }
    descargarBase64(res.base64, res.filename);
  };

  return (
    <Btn icon="file_download" onClick={exportar} disabled={generando || guardando}>
      {generando ? "Generando…" : "Excel"}
    </Btn>
  );
}

function MedidoresInterior({ records, sucursales, mesActual, meses }) {
  const { M } = useMedidores();
  const [sel, patch] = useState({
    sucursal: "",
    type: "",
    tab: "resumen",
    period: "3m",
    mensualMonth: mesActual,
  });
  const setSel = (p) => patch((s) => ({ ...s, ...p }));
  const [gestionando, setGestionando] = useState(false);

  const nombres = activeSucNames(sucursales);
  const listo = !!(sel.sucursal && sel.type);
  const meters = listo ? metersFor(M, sel.sucursal, sel.type) : [];
  const monthsView = periodToMonthKeys(sel.period, mesActual);
  const tipoLabel = MED_TYPES[sel.type] ? MED_TYPES[sel.type].label : sel.type;

  return (
    <div>
      <SectionHead
        eyebrow="Medidores"
        title="Lecturas de medidores"
        sub="Registra lecturas físicas por medidor, calcula consumo y costo, y compáralos con el consumo global registrado. Puedes configurar qué medidores son facturables y cuáles no. Estas lecturas y consumos no aportan al cálculo de impacto ambiental."
        right={
          <>
            <div className="rc-med-head-meta">
              <IndicadorGuardado />
              {listo && meters.length > 0 && (
                <BotonExcel sucursal={sel.sucursal} type={sel.type} meses={monthsView} />
              )}
            </div>
            <div className="rc-med-head-acciones">
              <Link className="prt-btn" href="/medidores/movil">
                <Icon name="smartphone" />
                Registro móvil
              </Link>
              {listo && (
                <Btn kind="primary" icon="tune" onClick={() => setGestionando(true)}>
                  Gestionar medidores
                </Btn>
              )}
            </div>
          </>
        }
      />

      {/* Las pestañas van en su propia fila, no comparten fila con los filtros. */}
      <div className="rc-med-tabsrow">
        <MedTabs value={sel.tab} onChange={(tab) => setSel({ tab })} />
      </div>

      <MedToolbar sel={sel} setSel={setSel} sucursales={sucursales} meses={meses} mesActual={mesActual} />

      {nombres.length === 0 ? (
        <EmptyState
          icon="apartment"
          title="No hay sucursales activas"
          body="Configura al menos una sucursal en Configuración para registrar medidores."
          actions={
            <Link className="prt-btn primary" href="/configuracion">
              <Icon name="settings" />
              Ir a Configuración
            </Link>
          }
        />
      ) : !listo ? (
        <EmptyState
          icon="speed"
          title="Selecciona sucursal y tipo"
          body="Elige una sucursal y un tipo de consumo en la barra superior para ver y registrar sus medidores."
        />
      ) : meters.length === 0 ? (
        <EmptyState
          icon="speed"
          title="Sin medidores configurados"
          body={`Aún no hay medidores activos para ${sel.sucursal} · ${tipoLabel}.`}
          actions={
            <Btn kind="primary" icon="add" onClick={() => setGestionando(true)}>
              Crear medidor
            </Btn>
          }
        />
      ) : (
        <div style={{ marginTop: 16 }}>
          {sel.tab === "resumen" && (
            <ResumenTab
              suc={sel.sucursal}
              type={sel.type}
              meters={meters}
              monthsView={monthsView}
              period={sel.period}
              mesActual={mesActual}
            />
          )}
          {sel.tab === "matriz" && (
            <MatrizTab
              suc={sel.sucursal}
              type={sel.type}
              meters={meters}
              monthsView={monthsView}
              records={records}
            />
          )}
          {sel.tab === "mensual" && (
            <MensualTab
              suc={sel.sucursal}
              type={sel.type}
              meters={meters}
              month={sel.mensualMonth}
              records={records}
            />
          )}
          {sel.tab === "pagos" && <PagosTab meters={meters} monthsView={monthsView} />}

          {(sel.tab === "matriz" || sel.tab === "pagos") && (
            <div
              className="prt-hint"
              style={{ fontSize: 12, marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}
            >
              <Icon name="info" size={14} />
              Período: {periodLabel(sel.period, mesActual)}. El consumo del primer mes de cada medidor no
              se calcula (solo lectura inicial).
            </div>
          )}
        </div>
      )}

      {gestionando && (
        <MedManageModal suc={sel.sucursal} type={sel.type} onClose={() => setGestionando(false)} />
      )}
    </div>
  );
}

export function Medidores({ medidores, records, sucursales, mesActual, meses }) {
  return (
    <MedidoresProvider inicial={medidores}>
      <MedidoresInterior
        records={records}
        sucursales={sucursales}
        mesActual={mesActual}
        meses={meses}
      />
    </MedidoresProvider>
  );
}
