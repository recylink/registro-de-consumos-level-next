// Pantalla 1 — Dashboard de Impacto Ambiental (emisiones GEI)

// ---------- Charts (nombres únicos para evitar colisiones) ----------
const EmisAreaChart = ({ months: monthArr, data, color = "var(--rl-success-600)", h = 230 }) => {
  const w = 640;
  const padL = 46, padR = 16, padT = 18, padB = 28;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const n = monthArr.length;
  const yMax = Math.max(...data, 1) * 1.1;
  const sx = i => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const sy = y => padT + (1 - y / yMax) * innerH;
  const points = data.map((y, i) => [sx(i), sy(y)]);
  // smoothPath se declara en dashboard.jsx (script global cargado antes).
  const line = (typeof smoothPath === "function" && n > 1)
    ? smoothPath(points)
    : data.map((y, i) => (i === 0 ? "M" : "L") + sx(i).toFixed(1) + "," + sy(y).toFixed(1)).join(" ");
  const area = line + ` L${sx(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${sx(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => yMax * t);

  const [hoverIdx, setHoverIdx] = React.useState(null);
  const colW = n > 1 ? innerW / (n - 1) : innerW;

  // Posicionamiento tooltip: porcentaje sobre viewBox para escalar con SVG responsive.
  const tipLeftPct = hoverIdx != null ? (sx(hoverIdx) / w) * 100 : 0;
  const tipTopPct  = hoverIdx != null ? (sy(data[hoverIdx]) / h) * 100 : 0;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="emisGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line key={i} x1={padL} x2={w - padR} y1={padT + t * innerH} y2={padT + t * innerH}
                stroke="var(--rl-gray-200)" strokeWidth="1" strokeDasharray={i === 4 ? "0" : "2 4"} />
        ))}
        {yTicks.map((v, i) => (
          <text key={i} x={padL - 8} y={sy(v) + 3} textAnchor="end" fontSize="10"
                fontFamily="var(--rl-font-display)" fill="var(--rl-gray-500)">{fmtTon(v, 0)}</text>
        ))}
        <text x={padL - 8} y={padT - 6} textAnchor="end" fontSize="10"
              fontFamily="var(--rl-font-display)" fill="var(--rl-gray-500)" fontWeight="700">tCO₂e</text>
        {monthArr.map((mk, i) => {
          if (n > 6 && i % Math.ceil(n / 6) !== 0) return null;
          return <text key={i} x={sx(i)} y={h - 8} textAnchor="middle" fontSize="10"
                       fontFamily="var(--rl-font-display)" fill="var(--rl-gray-500)">{monthLabelShort(mk)}</text>;
        })}
        <path d={area} fill="url(#emisGrad)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((y, i) => <circle key={i} cx={sx(i)} cy={sy(y)} r="3" fill="#FFFFFF" stroke={color} strokeWidth="2" />)}

        {hoverIdx != null && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={sx(hoverIdx)} x2={sx(hoverIdx)} y1={padT} y2={padT + innerH}
                  stroke="var(--rl-gray-500)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={sx(hoverIdx)} cy={sy(data[hoverIdx])} r="5"
                    fill={color} stroke="#FFFFFF" strokeWidth="2" />
          </g>
        )}

        {monthArr.map((mk, i) => (
          <rect key={"hover-" + i}
                x={sx(i) - colW / 2} y={padT}
                width={colW} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)} />
        ))}
      </svg>

      {hoverIdx != null && (
        <div style={{
          position: "absolute",
          left: tipLeftPct + "%",
          top:  tipTopPct  + "%",
          transform: "translate(-50%, calc(-100% - 12px))",
          background: "var(--rl-gray-900, #1A1A1A)",
          color: "#FFFFFF",
          padding: "8px 12px",
          borderRadius: 8,
          font: "500 12px/1.3 var(--rl-font-display)",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          pointerEvents: "none",
          zIndex: 2,
        }}>
          <div style={{ opacity: 0.7, fontSize: 11, textTransform: "capitalize" }}>
            {monthLabelShort(monthArr[hoverIdx])}
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>
            {fmtTon(data[hoverIdx])} <span style={{ opacity: 0.7, fontSize: 11 }}>tCO₂e</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Barras horizontales por sucursal (inactivas atenuadas + chip)
const EmisSucBars = ({ rows }) => {
  const max = Math.max(1, ...rows.map(r => r.tco2e));
  const sorted = [...rows].sort((a, b) => b.tco2e - a.tco2e);
  return (
    <div className="prt-stack-sm">
      {sorted.map(r => (
        <div key={r.id} className="emis-bar-row" style={{ opacity: r.activa ? 1 : 0.6 }}>
          <div className="emis-bar-label">
            <span style={{ fontWeight: 600, color: "var(--rl-gray-800)" }}>{r.nombre}</span>
            {!r.activa && <Chip size="sm">Inactiva</Chip>}
            {r.sinFactor && <Chip kind="warning" size="sm" icon="warning">Sin factor</Chip>}
          </div>
          <div className="emis-bar-track">
            <span className="emis-bar-fill" style={{
              width: (r.tco2e / max * 100) + "%",
              background: r.sinFactor ? "var(--rl-warning-300)" : r.activa ? "var(--rl-primary-900)" : "var(--rl-gray-300)",
            }}></span>
          </div>
          <div className="emis-bar-value">{r.sinFactor && r.tco2e === 0 ? "—" : fmtTon(r.tco2e)} <span className="prt-hint" style={{ fontSize: 11 }}>tCO₂e</span></div>
        </div>
      ))}
    </div>
  );
};

// Donut por categoría
const EmisCatDonut = ({ byCat, total }) => {
  const cats = Object.keys(CAT_META).filter(k => byCat[k] > 0);
  const r = 62, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="prt-row" style={{ gap: 24, alignItems: "center" }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--rl-gray-100)" strokeWidth="20" />
        {cats.map(k => {
          const frac = byCat[k] / total;
          const dash = frac * c;
          const el = (
            <circle key={k} cx="80" cy="80" r={r} fill="none"
                    stroke={CAT_META[k].color} strokeWidth="20"
                    strokeDasharray={`${dash} ${c - dash}`}
                    strokeDashoffset={-acc} transform="rotate(-90 80 80)" />
          );
          acc += dash;
          return el;
        })}
        <text x="80" y="74" textAnchor="middle" fontSize="22" fontWeight="700"
              fontFamily="var(--rl-font-display)" fill="var(--rl-gray-900)">{fmtTon(total, 0)}</text>
        <text x="80" y="92" textAnchor="middle" fontSize="10" fontFamily="var(--rl-font-display)"
              fill="var(--rl-gray-500)" letterSpacing="0.08em">tCO₂e TOTAL</text>
      </svg>
      <div className="prt-stack-sm" style={{ flex: 1 }}>
        {cats.map(k => (
          <div key={k} className="prt-spread" style={{ gap: 10 }}>
            <span className="prt-row" style={{ gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: CAT_META[k].color }}></span>
              <span style={{ font: "600 13px/1 var(--rl-font-display)", color: "var(--rl-gray-800)" }}>{CAT_META[k].label}</span>
            </span>
            <span className="prt-row" style={{ gap: 8 }}>
              <strong style={{ font: "700 13px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>{fmtTon(byCat[k])}</strong>
              <span className="prt-hint" style={{ fontSize: 11, minWidth: 34, textAlign: "right" }}>{Math.round(byCat[k] / total * 100)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---- Barra meta-anclada ----
// Eje: tope = meta (la línea de meta queda al borde derecho). Solo se estira si
// el valor real supera el 92% de la meta → tope = real/0.9 (el valor queda al
// ~90% del eje, nunca tocando el borde).
// mode "generacion": tope de tCO₂e, pasarse es malo → tramo rojo sobre la meta.
// mode "reduccion": % logrado, pasarse es bueno → tramo azul sobre la meta.
const EmisMetaBar = ({ mode, label, real, meta, fmt, unit }) => {
  const axisMax = meta > 0
    ? (real > meta * 0.92 ? real / 0.9 : meta)
    : (real > 0 ? real / 0.9 : 1);
  const pct = v => Math.max(0, Math.min(100, (v / axisMax) * 100));
  const metaPct = pct(meta);
  const increase = mode === "reduccion" && real < 0; // emite más que el año base

  const segs = [];
  if (mode === "generacion" && real > 0) {
    const greenEnd = Math.min(real, meta);
    if (greenEnd > 0) segs.push([0, greenEnd, "var(--rl-success-500)"]);
    if (real > meta) segs.push([meta, real, "var(--rl-error-500)"]);
  } else if (mode === "reduccion" && real > 0) {
    if (real < meta) {
      // el tramo logrado→meta queda descubierto: lo pinta el track con tinte rojo suave
      segs.push([0, real, "var(--rl-error-500)"]);
    } else {
      segs.push([0, meta, "var(--rl-success-500)"]);
      if (real > meta) segs.push([meta, real, "var(--rl-primary-800)"]);
    }
  }

  const valColor = increase || (mode === "generacion" && real > meta)
    ? "var(--rl-error-600)" : "var(--rl-gray-900)";
  const u = unit ? " " + unit : "";
  // Estado malo en reducción (bajo la meta o aumento): track con tinte rojo suave.
  const badTrack = mode === "reduccion" && real < meta;

  return (
    <div>
      <div className="prt-spread" style={{ marginBottom: 6 }}>
        <span style={{ font: "700 10px/1 var(--rl-font-display)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--rl-gray-500)" }}>{label}</span>
        <span style={{ font: "700 12px/1 var(--rl-font-display)", color: valColor }}>
          {fmt(real)}<span style={{ color: "var(--rl-gray-400)", fontWeight: 600 }}> / {fmt(meta)}{u}</span>
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <div className="emis-goal-track" style={{ overflow: "hidden", ...(badTrack ? { background: "var(--rl-error-50)" } : {}) }}>
          {segs.map((s, i) => (
            <span key={i} style={{
              position: "absolute", top: 0, bottom: 0,
              left: pct(s[0]) + "%", width: Math.max(0, pct(s[1]) - pct(s[0])) + "%",
              background: s[2],
            }}></span>
          ))}
        </div>
        <span className="emis-goal-marker" style={{ left: metaPct + "%" }} title="Meta"></span>
      </div>
      <div style={{ position: "relative", height: 13, marginTop: 4 }}>
        <span style={{
          position: "absolute", whiteSpace: "nowrap",
          font: "600 10px/1 var(--rl-font-display)", color: "var(--rl-gray-500)",
          ...(metaPct > 65 ? { right: (100 - metaPct) + "%" } : { left: metaPct + "%", transform: "translateX(-50%)" }),
        }}>Meta {fmt(meta)}{u}</span>
      </div>
      {increase && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, font: "600 11.5px/1.3 var(--rl-font-body)", color: "var(--rl-error-600)" }}>
          <Icon name="trending_up" size={13} /> aumento de {fmt(Math.abs(real))} vs año base
        </div>
      )}
    </div>
  );
};

// Progreso vs meta — 100% calculado desde datos reales.
// `current` llega anualizado (total del período / nº meses × 12).
const EmisGoalProgress = ({ current, absGoal, relGoal, baseYear, baseValue }) => {
  const hasAbs = absGoal > 0;
  const hasRel = relGoal > 0;
  const reduction = baseValue > 0 ? ((baseValue - current) / baseValue) * 100 : null;

  if (!hasAbs && !hasRel) {
    return (
      <div style={{ textAlign: "center", padding: "14px 10px" }}>
        <span className="prt-kpi-ico" style={{ width: 44, height: 44, margin: "0 auto 10px", background: "var(--rl-gray-100)", color: "var(--rl-gray-500)" }}>
          <Icon name="target" size={22} />
        </span>
        <div style={{ font: "600 14px/1.3 var(--rl-font-display)", color: "var(--rl-gray-800)", marginBottom: 6 }}>
          Sin meta definida
        </div>
        <div className="prt-hint" style={{ lineHeight: 1.5 }}>
          Define una meta absoluta (tope de tCO₂e) o relativa (% de reducción) para seguir el progreso.
        </div>
      </div>
    );
  }

  let chip;
  if (hasRel && reduction != null) {
    chip = reduction >= relGoal ? { kind: "success", icon: "check", label: "Meta cumplida" }
      : reduction > 0 ? { kind: "success", icon: "trending_down", label: "En progreso" }
      : { kind: "error", icon: "trending_up", label: "Aumento vs año base" };
  } else if (hasAbs) {
    chip = current <= absGoal ? { kind: "success", icon: "check", label: "Bajo el tope" }
      : { kind: "error", icon: "warning", label: "Tope excedido" };
  } else {
    chip = { kind: "warning", icon: "warning", label: "Falta año base" };
  }

  // Meta anual efectiva para las cifras de contexto.
  const goalEff = hasAbs ? absGoal : (baseValue > 0 ? baseValue * (1 - relGoal / 100) : null);

  return (
    <div>
      {/* % logrado junto a % meta (si es computable) */}
      <div className="prt-spread" style={{ alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          {hasRel && reduction != null ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ font: "700 28px/1 var(--rl-font-display)", color: reduction < 0 ? "var(--rl-error-600)" : "var(--rl-success-700)" }}>
                  {fmtTon(reduction, 1)}%
                </span>
                <span style={{ font: "600 15px/1 var(--rl-font-display)", color: "var(--rl-gray-400)" }}>/</span>
                <span style={{ font: "700 15px/1 var(--rl-font-display)", color: "var(--rl-gray-500)" }}>
                  {fmtTon(relGoal, 1)}%
                </span>
              </div>
              <div className="prt-hint" style={{ marginTop: 5 }}>logrado vs meta · año base {baseYear}</div>
            </>
          ) : (
            <>
              <span style={{ font: "700 28px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>{fmtTon(current, 0)}</span>
              <div className="prt-hint" style={{ marginTop: 5 }}>tCO₂e/año actual (anualizado)</div>
            </>
          )}
        </div>
        <Chip kind={chip.kind} size="sm" icon={chip.icon}>{chip.label}</Chip>
      </div>

      {/* Aclaración: dos lentes distintos */}
      {hasAbs && hasRel && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          background: "var(--rl-gray-50)", borderRadius: 8,
          padding: "9px 11px", marginBottom: 14,
        }}>
          <span style={{ color: "var(--rl-gray-400)", flexShrink: 0, marginTop: 1 }}><Icon name="info" size={14} /></span>
          <span className="prt-hint" style={{ fontSize: 11, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--rl-gray-600)" }}>Tope de emisiones</strong> mide
            el total absoluto del año (ej: 4 de 10 tCO₂e permitidas); <strong style={{ color: "var(--rl-gray-600)" }}>Reducción
            vs año base</strong> compara contra lo que emitías en {baseYear}. Puedes estar dentro del tope y aun
            así haber aumentado vs el año base.
          </span>
        </div>
      )}

      {/* Barras: tope de generación y/o reducción */}
      <div className="prt-stack-sm" style={{ gap: 14 }}>
        {hasAbs && (
          <EmisMetaBar mode="generacion" label="Tope de emisiones" real={current} meta={absGoal}
            fmt={v => fmtTon(v, 0)} unit="tCO₂e" />
        )}
        {hasRel && (reduction != null ? (
          <EmisMetaBar mode="reduccion" label="Reducción vs año base" real={reduction} meta={relGoal}
            fmt={v => fmtTon(v, 1) + "%"} unit="" />
        ) : (
          <div className="prt-hint" style={{ lineHeight: 1.5 }}>
            Define las emisiones del año base {baseYear} en Metas para medir la reducción lograda.
          </div>
        ))}
      </div>

      {/* Cifras de contexto */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16,
        padding: "12px 14px", background: "var(--rl-gray-50)", borderRadius: 10,
      }}>
        {[
          { label: "Actual (anualizado)", value: current },
          { label: `Año base ${baseYear}`, value: baseValue > 0 ? baseValue : null },
          { label: "Meta anual", value: goalEff },
        ].map(s => (
          <div key={s.label}>
            <div className="prt-hint" style={{ fontSize: 10.5, marginBottom: 3 }}>{s.label}</div>
            <div style={{ font: "700 14px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>
              {fmtTon(s.value, 0)} <span style={{ font: "500 10.5px/1 var(--rl-font-body)", color: "var(--rl-gray-500)" }}>tCO₂e</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- Barra de filtros (sucursal + período) — espejo del dashboard ----------
const ImpactoFilterBar = () => {
  const { state, dispatch } = useApp();
  const f = state.emisFilters;
  const set = (key, value) => dispatch({ type: "EMIS/SET_FILTER", key, value });
  const custom = parseCustomPeriod(f.period);
  const isCustom = !!custom;
  const selValue = isCustom ? "custom" : f.period;
  const defStart = months[0];
  const defEnd = CURRENT_MONTH_KEY;
  const onPeriodChange = (v) => {
    if (v === "custom") set("period", `custom:${defStart}:${defEnd}`);
    else set("period", v);
  };
  const setRange = (start, end) => set("period", `custom:${start}:${end}`);
  return (
    <div className="prt-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
      <Select
        style={{ width: 220 }}
        value={f.sucursal}
        onChange={(v) => set("sucursal", v)}
        options={[
          { value: "all", label: `Todas las sucursales (${activeSucNames(state).length})` },
          ...activeSucNames(state).map(s => ({ value: s, label: s })),
        ]}
      />
      <Select
        style={{ width: 200 }}
        value={selValue}
        onChange={(v) => onPeriodChange(v)}
        options={[
          { value: "12m", label: "Últimos 12 meses" },
          { value: "6m",  label: "Últimos 6 meses" },
          { value: "3m",  label: "Últimos 3 meses" },
          { value: "1m",  label: periodLabel("1m") },
          { value: "custom", label: "Personalizado…" },
        ]}
      />
      {isCustom && (
        <div className="prt-row" style={{ gap: 6, alignItems: "center" }}>
          <input type="month" className="prt-input" style={{ width: 150 }}
            value={custom.start} max={custom.end && custom.end < CURRENT_MONTH_KEY ? custom.end : CURRENT_MONTH_KEY}
            onChange={e => e.target.value && setRange(e.target.value, custom.end)} />
          <span className="prt-hint" style={{ opacity: 0.7 }}>—</span>
          <input type="month" className="prt-input" style={{ width: 150 }}
            value={custom.end} min={custom.start} max={CURRENT_MONTH_KEY}
            onChange={e => e.target.value && setRange(custom.start, e.target.value)} />
        </div>
      )}
      <Btn size="sm" kind="ghost" icon="filter_alt_off" onClick={() => {
        set("sucursal", "all"); set("period", "12m");
      }}>Limpiar filtros</Btn>
    </div>
  );
};

// ---------- Vista principal ----------
const ImpactoView = () => {
  const { state, dispatch } = useApp();
  const scopeFilter = state.emisScope;
  const filters = state.emisFilters;
  const periodLbl = periodLabel(filters.period);
  const agg = emissionsAggregate(state, filters);
  const month = emissionsByMonth(state, scopeFilter, filters);
  const bySuc = emissionsBySucursal(state, scopeFilter, filters);
  const sinFactor = sucursalesSinFactorNombres(state);

  // Año base / meta. Si el filtro apunta a una sucursal con meta propia se usa esa;
  // una sucursal que hereda no tiene emisiones de año base propias → sin comparación.
  const metasAll = state.emissions.metas;
  const sucSel = filters.sucursal !== "all"
    ? state.configSucursales.find(s => s.nombre === filters.sucursal)
    : null;
  const meta = sucSel ? metasAll.sucursales[sucSel.id] : metasAll.empresa;
  // Anualizar el período filtrado para comparar contra base/meta (valores anuales).
  const nMonths = Math.max(1, periodToMonthKeys(filters.period).length);
  const annualized = (agg.total / nMonths) * 12;
  // Base efectiva: "auto" toma lo registrado en el sistema ese año; "manual" el valor ingresado.
  const baseEmis = !meta ? 0
    : meta.baseMode === "auto"
      ? emissionsOfYear(state, meta.anioBase, sucSel ? sucSel.nombre : null)
      : parseFloat(meta.baseEmissions) || 0;
  const absGoal = meta ? parseFloat(meta.absoluta) || 0 : 0;
  const relGoal = meta ? parseFloat(meta.relativa) || 0 : 0;

  const scopeChips = [
    { id: "all", label: "Todos los alcances" },
    { id: "1", label: SCOPES[1].label },
    { id: "2", label: SCOPES[2].label },
    { id: "3", label: SCOPES[3].label },
  ];
  const lineColor = scopeFilter === "all" ? "var(--rl-success-600)" : SCOPE_COLORS[scopeFilter].stroke;

  return (
    <div>
      <SectionHead
        eyebrow={`Impacto Ambiental${COMPANY ? " · " + COMPANY : ""}`}
        title="Emisiones de gases de efecto invernadero"
        sub="Huella de carbono operacional medida en toneladas de CO₂ equivalente (tCO₂e), según la guía Huella Chile."
        right={<>
          <Btn icon="tune" onClick={() => dispatch({ type: "NAVIGATE", view: "factores" })}>Factores</Btn>
          <Btn kind="primary" icon="target" onClick={() => dispatch({ type: "NAVIGATE", view: "metas" })}>Metas</Btn>
        </>}
      />

      <ImpactoFilterBar />

      {/* Alerta global */}
      {sinFactor.length > 0 && (
        <div className="emis-alert" style={{ marginBottom: 18 }}>
          <span className="ico"><Icon name="warning" size={20} /></span>
          <div className="prt-grow">
            <div className="ttl">{sinFactor.length} sucursal{sinFactor.length > 1 ? "es" : ""} sin factor de emisión configurado</div>
            <div className="sub">
              {sinFactor.join(", ")} — sus consumos no se contabilizan en el total hasta definir el factor de su sistema eléctrico.
            </div>
          </div>
          <Btn size="sm" kind="primary" iconRight="arrow_forward" onClick={() => dispatch({ type: "NAVIGATE", view: "factores" })}>
            Configurar factores
          </Btn>
        </div>
      )}

      {/* KPIs: total + 3 alcances */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 16, marginBottom: 18 }}>
        <div className="prt-kpi" style={{ background: "var(--rl-primary-900)", color: "#FFFFFF" }}>
          <div className="prt-kpi-head">
            <span className="prt-kpi-label" style={{ color: "rgba(255,255,255,0.75)" }}>Total emisiones · {periodLbl}</span>
            <span className="prt-kpi-ico" style={{ background: "rgba(255,255,255,0.15)", color: "#FFFFFF" }}><Icon name="eco" size={22} /></span>
          </div>
          <div className="prt-kpi-value" style={{ color: "#FFFFFF" }}>
            <span>{fmtTon(agg.total)}</span><span className="unit" style={{ color: "rgba(255,255,255,0.7)" }}>tCO₂e</span>
          </div>
          <span className="prt-hint" style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
            huella operacional del período seleccionado
          </span>
        </div>
        {[1, 2, 3].map(s => {
          const v = agg.byScope[s];
          const pct = agg.total > 0 ? Math.round(v / agg.total * 100) : 0;
          return (
            <div key={s} className="prt-kpi">
              <div className="prt-kpi-head">
                <span className="prt-kpi-label">{SCOPES[s].label}</span>
                <span className="prt-kpi-ico" style={{ background: SCOPES[s].bg, color: SCOPES[s].color }}>
                  <Icon name={s === 1 ? "local_gas_station" : s === 2 ? "bolt" : "water_drop"} size={20} />
                </span>
              </div>
              <div className="prt-kpi-value"><span>{fmtTon(v)}</span><span className="unit">tCO₂e</span></div>
              <div className="prt-row" style={{ gap: 8 }}>
                <span className="prt-hint" style={{ fontSize: 11 }}>{SCOPES[s].desc} · {pct}% del total</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Evolución + meta */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18, marginBottom: 18 }}>
        <Card flush>
          <div className="prt-card-head">
            <div>
              <div className="prt-h3">Evolución de emisiones</div>
              <div className="prt-hint" style={{ marginTop: 2 }}>tCO₂e por mes · {periodLbl.toLowerCase()}</div>
            </div>
            <div className="prt-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {scopeChips.map(sc => (
                <button key={sc.id}
                  className={"prt-pill" + (scopeFilter === sc.id ? " active" : "")}
                  onClick={() => dispatch({ type: "EMIS/SET_SCOPE", scope: sc.id })}>
                  {sc.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: "18px 22px 14px" }}>
            <EmisAreaChart months={month.months} data={month.data} color={lineColor} />
          </div>
        </Card>

        <Card>
          <div className="prt-row" style={{ gap: 8, marginBottom: 16 }}>
            <span className="prt-kpi-ico" style={{ width: 36, height: 36, background: "var(--rl-success-50)", color: "var(--rl-success-700)" }}><Icon name="target" size={18} /></span>
            <div>
              <div className="prt-h3">Progreso vs meta</div>
              <div className="prt-hint">{sucSel ? `Meta de ${sucSel.nombre}` : "Meta de reducción de empresa"}</div>
            </div>
          </div>
          <EmisGoalProgress current={annualized} absGoal={absGoal} relGoal={relGoal}
            baseYear={meta ? meta.anioBase : ""} baseValue={baseEmis} />
          <div className="prt-divider" style={{ margin: "18px 0 14px" }}></div>
          <button className="prt-btn sm" style={{ width: "100%" }} onClick={() => dispatch({ type: "NAVIGATE", view: "metas" })}>
            <Icon name="edit" size={15} /> Ajustar metas
          </button>
        </Card>
      </div>

      {/* Por categoría + por sucursal */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 18 }}>
        <Card>
          <div className="prt-h3" style={{ marginBottom: 4 }}>tCO₂e por tipo de consumo</div>
          <div className="prt-hint" style={{ marginBottom: 18 }}>Distribución de la huella total</div>
          <EmisCatDonut byCat={agg.byCat} total={agg.total} />
        </Card>

        <Card flush>
          <div className="prt-card-head">
            <div>
              <div className="prt-h3">Comparativa entre sucursales</div>
              <div className="prt-hint" style={{ marginTop: 2 }}>
                {scopeFilter === "all" ? "Todos los alcances" : SCOPES[scopeFilter].label} · tCO₂e · {periodLbl.toLowerCase()}
              </div>
            </div>
            <Chip>{bySuc.filter(s => s.activa).length} activas</Chip>
          </div>
          <div className="prt-card-body">
            <EmisSucBars rows={bySuc} />
          </div>
        </Card>
      </div>
    </div>
  );
};

Object.assign(window, { ImpactoView });
