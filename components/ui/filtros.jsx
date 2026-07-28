"use client";

// Barra de filtros sucursal + período. El dashboard y la pantalla de Impacto
// tenían cada uno su copia (DashFilterBar e ImpactoFilterBar, ~50 líneas
// idénticas salvo el nombre de la acción que despachaban). Acá es un solo
// componente.

import { Btn, Select } from "@/components/ui/controls";
import { parseCustomPeriod, monthsWindow, periodLabel } from "@/lib/domain/periods";
import { activeSucNames } from "@/lib/domain/sucursales";

export function FiltrosSucursalPeriodo({ sucursal, period, sucursales, mesActual, onChange, onReset }) {
  const custom = parseCustomPeriod(period);
  const nombres = activeSucNames(sucursales);
  const ventana = monthsWindow(mesActual, 12);

  const cambiarPeriodo = (v) =>
    onChange("period", v === "custom" ? `custom:${ventana[0]}:${mesActual}` : v);
  const setRango = (start, end) => onChange("period", `custom:${start}:${end}`);

  return (
    <div className="prt-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
      <Select
        style={{ width: 220 }}
        value={sucursal}
        onChange={(v) => onChange("sucursal", v)}
        options={[
          { value: "all", label: `Todas las sucursales (${nombres.length})` },
          ...nombres.map((s) => ({ value: s, label: s })),
        ]}
      />
      <Select
        style={{ width: 200 }}
        value={custom ? "custom" : period}
        onChange={cambiarPeriodo}
        options={[
          { value: "12m", label: "Últimos 12 meses" },
          { value: "6m", label: "Últimos 6 meses" },
          { value: "3m", label: "Últimos 3 meses" },
          { value: "1m", label: periodLabel("1m", mesActual) },
          { value: "custom", label: "Personalizado…" },
        ]}
      />
      {custom && (
        <div className="prt-row" style={{ gap: 6, alignItems: "center" }}>
          <input
            type="month"
            className="prt-input"
            style={{ width: 150 }}
            value={custom.start}
            max={custom.end && custom.end < mesActual ? custom.end : mesActual}
            onChange={(e) => e.target.value && setRango(e.target.value, custom.end)}
          />
          <span className="prt-hint" style={{ opacity: 0.7 }}>—</span>
          <input
            type="month"
            className="prt-input"
            style={{ width: 150 }}
            value={custom.end}
            min={custom.start}
            max={mesActual}
            onChange={(e) => e.target.value && setRango(custom.start, e.target.value)}
          />
        </div>
      )}
      <Btn size="sm" kind="ghost" icon="filter_alt_off" onClick={onReset}>
        Limpiar filtros
      </Btn>
    </div>
  );
}
