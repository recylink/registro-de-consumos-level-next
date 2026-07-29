// Pantalla 3 — Definición de metas de reducción

// Años base disponibles: desde 2021 hasta el último año calendario completo.
const aniosBase = (() => {
  const last = new Date().getFullYear() - 1;
  const out = [];
  for (let a = 2021; a <= last; a++) out.push(a);
  return out;
})();

// Bloque editor de una meta (empresa o sucursal).
// `currentAnnual` (opcional): emisiones reales de los últimos 12 meses, solo referencia.
// `getAutoBase(year)`: emisiones registradas en el sistema para ese año calendario.
const MetaEditor = ({ meta, onPatch, currentAnnual, getAutoBase }) => {
  const mode = meta.baseMode === "auto" ? "auto" : "manual";
  const autoBase = getAutoBase ? getAutoBase(meta.anioBase) : 0;
  const base = mode === "auto" ? autoBase : (parseFloat(meta.baseEmissions) || 0);
  const abs = parseFloat(meta.absoluta) || 0;
  const rel = parseFloat(meta.relativa) || 0;
  // coherencia: reducción relativa implícita por meta absoluta
  const relFromAbs = base > 0 ? ((base - abs) / base) * 100 : 0;

  return (
    <div className="prt-stack-md">
      {/* Año base + emisiones del año base (compartido por ambas metas) */}
      <div className="emis-meta-card">
        <div className="prt-row" style={{ gap: 10, marginBottom: 14 }}>
          <span className="prt-kpi-ico" style={{ width: 38, height: 38, background: "var(--rl-gray-100)", color: "var(--rl-gray-700)" }}><Icon name="history" size={18} /></span>
          <div>
            <div className="prt-h4">Año base</div>
            <div className="prt-hint">Punto de comparación del inventario</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
          <Field label="Año base">
            <Select value={String(meta.anioBase)} options={aniosBase.map(a => ({ value: String(a), label: String(a) }))}
              onChange={v => onPatch({ anioBase: parseInt(v, 10) })} />
          </Field>
          <Field label="Fuente de emisiones">
            <div className="prt-row" style={{ gap: 6 }}>
              <button className={"prt-pill" + (mode === "auto" ? " active" : "")}
                onClick={() => onPatch({ baseMode: "auto" })}>Desde registros</button>
              <button className={"prt-pill" + (mode === "manual" ? " active" : "")}
                onClick={() => onPatch({ baseMode: "manual" })}>Manual</button>
            </div>
          </Field>
          <Field label={`Emisiones en ${meta.anioBase}`}>
            {mode === "auto" ? (
              <div className="prt-input-wrap has-suffix">
                <input className="prt-input" value={fmtTon(autoBase, 1)} readOnly disabled
                  style={{ background: "var(--rl-gray-50)", color: "var(--rl-gray-700)" }} />
                <span className="prt-suffix">tCO₂e</span>
              </div>
            ) : (
              <div className="prt-input-wrap has-suffix">
                <input className="prt-input" type="number" min="0" value={meta.baseEmissions ?? ""}
                  onChange={e => onPatch({ baseEmissions: e.target.value })} placeholder="Ej: 2.100" />
                <span className="prt-suffix">tCO₂e</span>
              </div>
            )}
          </Field>
        </div>
        {mode === "auto" && autoBase === 0 ? (
          <div className="prt-hint" style={{ marginTop: 8, color: "var(--rl-warning-700, #B45309)" }}>
            <Icon name="warning" size={13} /> No hay consumos registrados en {meta.anioBase}. Cambia a "Manual" e ingresa el total de tu inventario de ese año.
          </div>
        ) : (
          <div className="prt-hint" style={{ marginTop: 8 }}>
            {mode === "auto"
              ? `Calculado desde los consumos registrados en ${meta.anioBase} con los factores vigentes.`
              : `Total de tu inventario GEI en ${meta.anioBase}. Sin este valor no se puede calcular la reducción lograda.`}
            {currentAnnual > 0 && <> Referencia: últimos 12 meses ≈ <strong style={{ color: "var(--rl-gray-700)" }}>{fmtTon(currentAnnual, 0)}</strong> tCO₂e.</>}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {/* Meta absoluta */}
      <div className="emis-meta-card">
        <div className="prt-row" style={{ gap: 10, marginBottom: 14 }}>
          <span className="prt-kpi-ico" style={{ width: 38, height: 38, background: "var(--rl-primary-50)", color: "var(--rl-primary-900)" }}><Icon name="eco" size={18} /></span>
          <div>
            <div className="prt-h4">Meta absoluta</div>
            <div className="prt-hint">Emisiones máximas por año</div>
          </div>
        </div>
        <Field label="Tope anual de emisiones">
          <div className="prt-input-wrap has-suffix">
            <input className="prt-input" type="number" value={meta.absoluta}
              onChange={e => onPatch({ absoluta: e.target.value })} placeholder="Ej: 1.850" />
            <span className="prt-suffix">tCO₂e/año</span>
          </div>
        </Field>
        {base > 0 && abs > 0 && (
          <div className="prt-hint" style={{ marginTop: 8 }}>
            Equivale a <strong style={{ color: "var(--rl-gray-700)" }}>{fmtTon(relFromAbs, 1)}%</strong> de reducción vs. {meta.anioBase}.
          </div>
        )}
      </div>

      {/* Meta relativa */}
      <div className="emis-meta-card">
        <div className="prt-row" style={{ gap: 10, marginBottom: 14 }}>
          <span className="prt-kpi-ico" style={{ width: 38, height: 38, background: "var(--rl-success-50)", color: "var(--rl-success-700)" }}><Icon name="percent" size={18} /></span>
          <div>
            <div className="prt-h4">Meta relativa</div>
            <div className="prt-hint">Reducción vs. año base</div>
          </div>
        </div>
        <Field label="Reducción objetivo">
          <div className="prt-input-wrap has-suffix">
            <input className="prt-input" type="number" value={meta.relativa}
              onChange={e => onPatch({ relativa: e.target.value })} placeholder="30" />
            <span className="prt-suffix">%</span>
          </div>
        </Field>
        {rel > 0 && base > 0 && (
          <div className="prt-hint" style={{ marginTop: 8 }}>
            Objetivo: <strong style={{ color: "var(--rl-gray-700)" }}>{fmtTon(base * (1 - rel / 100), 0)}</strong> tCO₂e/año.
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

const MetasView = () => {
  const { state, dispatch } = useApp();
  const metas = state.emissions.metas;
  // emisiones reales de los últimos 12 meses — solo referencia visual, no base de cálculo
  const agg = emissionsAggregate(state);
  const annual = agg.total;
  const bySuc = emissionsBySucursal(state, "all");
  const annualOfSuc = id => {
    const s = bySuc.find(x => x.id === id);
    return s ? s.tco2e : 0;
  };

  return (
    <div>
      <SectionHead
        eyebrow="Impacto Ambiental / Configuración"
        title="Metas de reducción"
        sub="Establece objetivos de reducción de emisiones a nivel de empresa y, opcionalmente, por sucursal."
        right={<Btn icon="arrow_back" onClick={() => dispatch({ type: "NAVIGATE", view: "impacto" })}>Volver al impacto</Btn>}
      />

      {/* Meta de empresa */}
      <Card style={{ marginBottom: 18 }}>
        <div className="prt-spread" style={{ marginBottom: 18 }}>
          <div className="prt-row" style={{ gap: 12 }}>
            <span className="prt-kpi-ico" style={{ width: 44, height: 44, background: "var(--rl-primary-900)", color: "#FFFFFF" }}><Icon name="factory" size={20} /></span>
            <div>
              <div className="prt-h2">Meta de empresa</div>
              <div className="prt-hint">Objetivo corporativo{COMPANY ? " · " + COMPANY : ""}</div>
            </div>
          </div>
          <Chip kind="info" size="sm">Últimos 12 meses ≈ {fmtTon(annual, 0)} tCO₂e</Chip>
        </div>
        <MetaEditor
          meta={metas.empresa}
          currentAnnual={annual}
          getAutoBase={year => emissionsOfYear(state, year, null)}
          onPatch={patch => dispatch({ type: "EMIS/SET_META_EMPRESA", patch })}
        />
      </Card>

      {/* Metas por sucursal */}
      <div className="prt-spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="prt-h3">Metas por sucursal</div>
          <div className="prt-hint" style={{ marginTop: 2 }}>Cada sucursal puede heredar la meta de empresa o definir la suya propia.</div>
        </div>
      </div>

      <div className="prt-stack-md">
        {state.configSucursales.map(suc => {
          const has = !!metas.sucursales[suc.id];
          const sucAnnual = annualOfSuc(suc.id);
          const meta = metas.sucursales[suc.id] || { absoluta: "", relativa: "", anioBase: metas.empresa.anioBase, baseEmissions: "" };
          return (
            <Card key={suc.id} flush>
              <div className="prt-card-head">
                <div className="prt-row" style={{ gap: 12 }}>
                  <span className="prt-kpi-ico" style={{ width: 38, height: 38, background: "var(--rl-gray-100)", color: "var(--rl-gray-600)" }}><Icon name="apartment" size={18} /></span>
                  <div>
                    <div className="prt-h4">{suc.nombre}</div>
                    <div className="prt-hint">
                      {has ? "Meta propia definida" : "Hereda la meta de empresa"} · últimos 12m ≈ {fmtTon(sucAnnual, 0)} tCO₂e
                    </div>
                  </div>
                  {!suc.activa && <Chip size="sm">Inactiva</Chip>}
                </div>
                {has ? (
                  <Btn size="sm" kind="ghost" icon="undo" onClick={() => {
                    dispatch({ type: "EMIS/CLEAR_META_SUC", sucId: suc.id });
                    dispatch({ type: "TOAST/SHOW", toast: { kind: "success", title: "Meta restablecida", body: `${suc.nombre} vuelve a heredar la meta de empresa.` } });
                  }}>Volver a heredar</Btn>
                ) : (
                  <Btn size="sm" icon="add" onClick={() => dispatch({ type: "EMIS/SET_META_SUC", sucId: suc.id, patch: {
                    absoluta: "", relativa: metas.empresa.relativa,
                    anioBase: metas.empresa.anioBase, baseEmissions: "",
                    baseMode: metas.empresa.baseMode || "manual",
                  } })}>Definir meta propia</Btn>
                )}
              </div>
              {has && (
                <div style={{ padding: "18px 22px 22px" }}>
                  <MetaEditor
                    meta={meta}
                    currentAnnual={sucAnnual}
                    getAutoBase={year => emissionsOfYear(state, year, suc.nombre)}
                    onPatch={patch => dispatch({ type: "EMIS/SET_META_SUC", sucId: suc.id, patch })}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="prt-row" style={{ justifyContent: "flex-end", marginTop: 22 }}>
        <Btn kind="primary" icon="check" onClick={() => {
          dispatch({ type: "TOAST/SHOW", toast: { kind: "success", title: "Metas guardadas", body: "Los objetivos de reducción se aplicaron al dashboard de impacto." } });
          dispatch({ type: "NAVIGATE", view: "impacto" });
        }}>Guardar metas</Btn>
      </div>
    </div>
  );
};

Object.assign(window, { MetasView });
