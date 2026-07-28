"use client";

// Dashboard. Portado de proto/dashboard.jsx.
//
// Los filtros son estado local del componente, no de la URL: los registros ya
// están en el cliente, así que filtrar es instantáneo, mientras que codificarlos
// en la URL obligaría a un viaje al servidor por cada click en una pestaña o una
// píldora de subcategoría. Lo que sí toca el servidor es cada edición de la
// tabla, que escribe en la planilla.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Btn, Select } from "@/components/ui/controls";
import { Card, Chip, EmptyState, SectionHead } from "@/components/ui/layout";
import { FiltrosSucursalPeriodo } from "@/components/ui/filtros";
import { MultiLineChart } from "@/components/charts/multi-line";
import { Heatmap } from "@/components/charts/heatmap";
import { DashboardTabla } from "@/components/views/dashboard-tabla";
import { refreshRecordsAction } from "@/app/actions/records";
import { TYPES } from "@/lib/domain/catalog";
import {
  FILTROS_INICIALES, calcularKpis, datosGrafico, datosHeatmap, filtrarRegistros, totalesPorTipo,
} from "@/lib/domain/dashboard";
import { fmtCLP, fmtNum, monthLabelShort } from "@/lib/domain/format";
import { periodLabel } from "@/lib/domain/periods";
import { activeSucNames, getSubcatsFor } from "@/lib/domain/sucursales";

function KpiCard({ label, value, unit, icon, color, bg, delta, deltaKind, secondary, sub, href, footer }) {
  const contenido = (
    <>
      <div className="prt-kpi-head">
        <span className="prt-kpi-label">{label}</span>
        <span className="prt-kpi-ico" style={{ background: bg, color }}>
          <Icon name={icon} size={22} />
        </span>
      </div>
      <div className="prt-kpi-value">
        <span>{value}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {secondary && (
        <div className="prt-hint" style={{ fontSize: 12, marginTop: 2 }}>{secondary}</div>
      )}
      {(delta != null || sub) && (
        <div className="prt-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {delta != null && (
            <span className={"prt-kpi-delta " + (deltaKind || "neutral")}>
              <Icon
                name={deltaKind === "up" ? "trending_up" : deltaKind === "dn" ? "trending_down" : "trending_flat"}
                size={13}
              />
              {(delta > 0 ? "+" : "") + delta.toFixed(1) + "%"}
            </span>
          )}
          {sub && <span className="prt-hint" style={{ fontSize: 11 }}>{sub}</span>}
        </div>
      )}
      {footer && (
        <>
          <div className="prt-kpi-divider" />
          <div className="prt-kpi-footer">{footer}</div>
        </>
      )}
    </>
  );

  // El KPI que lleva a otra pantalla es un link, no un div con onClick: gana
  // teclado, menú contextual y "abrir en pestaña nueva" sin código extra.
  return href ? (
    <Link className="prt-kpi prt-kpi-clickable" href={href}>{contenido}</Link>
  ) : (
    <div className="prt-kpi">{contenido}</div>
  );
}

function PestanasTipo({ activo, totales, onChange }) {
  return (
    <div className="prt-type-tabs">
      {Object.values(TYPES).map((t) => (
        <button
          key={t.id}
          className={"prt-type-tab " + t.id + (activo === t.id ? " active" : "")}
          onClick={() => onChange(t.id)}
        >
          <span className="ico">
            <Icon name={t.icon} size={20} />
          </span>
          <div>
            <div className="lbl">{t.label}</div>
            <div className="sub">
              {fmtNum(totales[t.id])} {t.unit}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function PildorasSubcat({ typeTab, subcat, subs, onChange }) {
  if (subs.length === 0) {
    return (
      <div className="prt-subcat-bar">
        <span className="prt-eyebrow" style={{ color: "var(--rl-gray-500)" }}>
          {TYPES[typeTab].label} no usa subcategorías.
        </span>
      </div>
    );
  }
  return (
    <div className="prt-subcat-bar">
      <span className="prt-eyebrow" style={{ marginRight: 4 }}>Subcategoría</span>
      <button
        className={"prt-pill" + (subcat === "all" ? " active " + typeTab : "")}
        onClick={() => onChange("all")}
      >
        Todas
      </button>
      {subs.map((s) => (
        <button
          key={s.id}
          className={"prt-pill" + (subcat === s.id ? " active " + typeTab : "")}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
      {/* El prototipo tenía acá un botón "Crear nueva" con window.prompt. No
          servía: agregaba la subcategoría a un arreglo local que nunca se
          guardaba, y para agua y combustible las opciones se derivan de la
          configuración de cada sucursal, así que ni siquiera aparecía. Las
          subcategorías se crean donde viven. */}
      <Link className="prt-pill dashed" href="/configuracion">
        <Icon name="add" size={12} /> Configurar subcategorías
      </Link>
      <span className="prt-hint" style={{ marginLeft: "auto", fontSize: 11 }}>
        Filtra gráfico y tabla.
      </span>
    </div>
  );
}

function BloqueGraficos({ chart, heat, color, periodo, mesActual }) {
  const titulo = (label) => (label ? `Tendencia · ${label}` : "Tendencia por subcategoría");
  if (!chart.mixed) {
    return (
      <div style={{ padding: "20px 22px 22px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 28 }}>
        <div>
          <div className="prt-spread" style={{ marginBottom: 8 }}>
            <div>
              <div className="prt-h3">{titulo()}</div>
              <div className="prt-hint">
                {chart.unit} / mes · {periodLabel(periodo, mesActual)}
              </div>
            </div>
            <Chip>{chart.unit}</Chip>
          </div>
          <MultiLineChart months={chart.months} series={chart.series} unit={chart.unit} />
        </div>
        <div>
          <div className="prt-spread" style={{ marginBottom: 8 }}>
            <div>
              <div className="prt-h3">Consumo por sucursal</div>
              <div className="prt-hint">Suma · {heat.unit}</div>
            </div>
            <Chip>Heatmap</Chip>
          </div>
          <Heatmap months={heat.months} rows={heat.rows} color={color} unit={heat.unit} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 22px 22px", display: "flex", flexDirection: "column", gap: 28 }}>
      {chart.blocks.map((block) => {
        const heatBlock = heat.mixed ? heat.blocks.find((b) => b.unit === block.unit) : null;
        return (
          <div key={block.unit} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 28 }}>
            <div>
              <div className="prt-spread" style={{ marginBottom: 8 }}>
                <div>
                  <div className="prt-h3">{titulo(block.label)}</div>
                  <div className="prt-hint">
                    {block.unit} / mes · {periodLabel(periodo, mesActual)}
                  </div>
                </div>
                <Chip>{block.unit}</Chip>
              </div>
              <MultiLineChart months={chart.months} series={block.series} unit={block.unit} />
            </div>
            <div>
              <div className="prt-spread" style={{ marginBottom: 8 }}>
                <div>
                  <div className="prt-h3">Consumo por sucursal · {block.label}</div>
                  <div className="prt-hint">Suma · {block.unit}</div>
                </div>
                <Chip>Heatmap</Chip>
              </div>
              {heatBlock ? (
                <Heatmap months={heatBlock.months} rows={heatBlock.rows} color={color} unit={block.unit} />
              ) : (
                <div className="prt-hint">Sin datos para esta unidad.</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard({ records, sucursales, mesActual }) {
  const router = useRouter();
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [refrescando, setRefrescando] = useState(false);

  const setFiltro = (key, value) => {
    if (key === "_reset") return setFiltros(FILTROS_INICIALES);
    // Cambiar de tipo invalida la subcategoría elegida: pertenece al tipo viejo.
    setFiltros((f) => ({ ...f, [key]: value, ...(key === "typeTab" ? { subcat: "all" } : {}) }));
  };

  const entrada = useMemo(
    () => ({ records, sucursales, filtros, anchor: mesActual }),
    [records, sucursales, filtros, mesActual],
  );

  const kpis = useMemo(() => calcularKpis(entrada), [entrada]);
  const chart = useMemo(() => datosGrafico(entrada), [entrada]);
  const heat = useMemo(() => datosHeatmap(entrada), [entrada]);
  const totales = useMemo(() => totalesPorTipo(entrada), [entrada]);
  const filtrados = useMemo(() => filtrarRegistros(records, filtros, mesActual), [records, filtros, mesActual]);
  const subs = getSubcatsFor(sucursales, filtros.typeTab);

  const tipo = TYPES[filtros.typeTab];
  const mesPrevioLbl = monthLabelShort(kpis.mesPrevio);

  const refrescar = async () => {
    setRefrescando(true);
    await refreshRecordsAction();
    router.refresh();
    setRefrescando(false);
  };

  const acciones = (
    <>
      <Btn icon={refrescando ? "" : "refresh"} onClick={refrescar} disabled={refrescando}>
        {refrescando ? (
          <>
            <span className="prt-spinner" style={{ marginRight: 6 }} />
            Cargando…
          </>
        ) : (
          "Refrescar"
        )}
      </Btn>
      <Link className="prt-btn" href="/registrar/manual">
        <Icon name="edit" />
        Registrar manual
      </Link>
      <Link className="prt-btn primary" href="/registrar/subir">
        <Icon name="cloud_upload" />
        Subir documento
      </Link>
    </>
  );

  if (records.length === 0) {
    return (
      <div>
        <SectionHead eyebrow="Dashboard" title="Consumos de servicios básicos" right={acciones} />
        <EmptyState
          icon="inbox"
          title="Aún no hay consumos registrados"
          body="Cuando ingreses tu primer consumo —a mano o subiendo documentos— acá verás KPIs, tendencias por tipo y la tabla detallada."
          actions={
            <>
              <Link className="prt-btn primary" href="/registrar/manual">
                <Icon name="edit" />
                Registrar manualmente
              </Link>
              <Link className="prt-btn" href="/registrar/subir">
                <Icon name="cloud_upload" />
                Subir documento
              </Link>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <SectionHead eyebrow="Dashboard" title="Consumos de servicios básicos" right={acciones} />

      <FiltrosSucursalPeriodo
        sucursal={filtros.sucursal}
        period={filtros.period}
        sucursales={sucursales}
        mesActual={mesActual}
        onChange={setFiltro}
        onReset={() => setFiltro("_reset")}
      />

      <div className="rc-kpi-grid">
        <KpiCard
          label={`${tipo.label} en periodo`}
          value={fmtNum(kpis.tipoPeriodo)}
          unit={tipo.unit}
          icon={tipo.icon}
          color={tipo.color}
          bg={tipo.bg}
          secondary={`${fmtNum(kpis.tipoActual)} ${tipo.unit} este mes`}
          delta={kpis.tipoDelta}
          deltaKind={kpis.tipoDelta < 0 ? "dn" : kpis.tipoDelta > 1 ? "up" : "neutral"}
          sub={`vs. ${mesPrevioLbl}`}
        />
        <KpiCard
          label="Costo total periodo"
          value={fmtCLP(kpis.costoPeriodo)}
          icon="payments"
          color="var(--rl-primary-900)"
          bg="var(--rl-primary-50)"
          secondary={`${fmtCLP(kpis.costoActual)} este mes`}
          delta={kpis.costoDelta}
          deltaKind={kpis.costoDelta < 0 ? "dn" : "up"}
          sub={`vs. ${mesPrevioLbl} · CLP`}
        />
        <KpiCard
          label="Sucursales al día"
          value={kpis.sucursalesQueReportan}
          unit={`/ ${kpis.totalSucursales}`}
          icon="apartment"
          color="var(--rl-success-700)"
          bg="var(--rl-success-50)"
          sub={
            kpis.sucursalesQueReportan === kpis.totalSucursales
              ? "Todas reportaron"
              : `${kpis.totalSucursales - kpis.sucursalesQueReportan} sin reportar`
          }
          href="/matriz"
          footer={
            <span className="prt-row" style={{ gap: 4, color: "var(--rl-primary-900)", fontWeight: 600 }}>
              Ver detalle <Icon name="arrow_forward" size={14} />
            </span>
          }
        />
        <KpiCard
          label="Registros en periodo"
          value={fmtNum(kpis.registrosEnPeriodo)}
          icon="receipt_long"
          color="var(--rl-gray-700)"
          bg="var(--rl-gray-100)"
          sub={periodLabel(filtros.period, mesActual)}
        />
      </div>

      <Card flush style={{ marginBottom: 18 }}>
        <PestanasTipo activo={filtros.typeTab} totales={totales} onChange={(v) => setFiltro("typeTab", v)} />
        <PildorasSubcat
          typeTab={filtros.typeTab}
          subcat={filtros.subcat}
          subs={subs}
          onChange={(v) => setFiltro("subcat", v)}
        />
        {(chart.mixed || heat.mixed) && (
          <div className="prt-mixed-units-notice">
            <Icon name="info" size={14} />
            <span>
              Las subcategorías activas usan distintas unidades — se muestran en bloques separados
              porque no son comparables.
            </span>
          </div>
        )}
        <BloqueGraficos
          chart={chart}
          heat={heat}
          color={tipo.color}
          periodo={filtros.period}
          mesActual={mesActual}
        />
      </Card>

      <DashboardTabla
        registros={filtrados}
        sucursales={sucursales}
        estado={filtros.estado}
        onEstado={(v) => setFiltro("estado", v)}
        mesActual={mesActual}
      />
    </div>
  );
}
