"use client";

// Factores de emisión. Portado de proto/factores.jsx.
//
// Cada cambio guarda el objeto de emisiones completo (la hoja se reescribe
// entera, igual que en el prototipo) y actualiza el estado local al mismo tiempo,
// así el valor nuevo se ve sin esperar el viaje al servidor.
//
// Se implementa algo que el prototipo prometía y no hacía: al cambiar un factor
// de empresa, los valores propios de las sucursales para ese mismo factor quedan
// marcados como "pendiente de revisión". El aviso ya existía ("Factor de empresa
// cambió — revisa tus valores personalizados"), pero nada ponía la marca en true:
// solo se leía de la planilla y solo se podía apagar. Era un aviso que nunca
// aparecía.

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Btn, Select } from "@/components/ui/controls";
import { Card, Chip, SectionHead } from "@/components/ui/layout";
import { useAccion } from "@/components/use-accion";
import { saveEmissionsAction } from "@/app/actions/config";
import { fmtTon } from "@/lib/domain/format";
import { EMISSION_FACTOR_CATALOG, REFRIGERANTES_CATALOG, SCOPES } from "@/lib/domain/emisiones";
import { CAT_META, esFactorPropio, factorFor, overridesPendientes } from "@/lib/domain/emisiones-calc";
import { nextRefrigId } from "@/lib/domain/ids";

const GWP = Object.fromEntries(REFRIGERANTES_CATALOG.map((r) => [r.id, r.gwp]));

function EditorValor({ value, unit, onCommit, onCancel }) {
  const [v, setV] = useState(String(value));
  return (
    <div className="prt-row" style={{ gap: 8 }}>
      <div className="prt-input-wrap has-suffix" style={{ width: 150 }}>
        <input
          className="prt-input"
          type="number"
          step="0.0001"
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(parseFloat(v));
            if (e.key === "Escape") onCancel();
          }}
          style={{ height: 38 }}
        />
        <span className="prt-suffix" style={{ fontSize: 11 }}>{unit.replace("kgCO₂e/", "/")}</span>
      </div>
      <button
        className="ob-icon-btn rc-icon-hover"
        style={{ color: "var(--rl-success-600)" }}
        title="Guardar"
        onClick={() => onCommit(parseFloat(v))}
      >
        <Icon name="check" size={16} />
      </button>
      <button className="ob-icon-btn rc-icon-hover" title="Cancelar" onClick={onCancel}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

function FilaFactor({ keyName, fdef, nivel, sucId, emissions, onEmpresa, onOverride, onReset }) {
  const [editando, setEditando] = useState(false);

  const valorEmpresa = emissions.factoresEmpresa[keyName].value;
  const propio = nivel === "suc" && esFactorPropio(emissions, sucId, keyName);
  const pendiente = propio && emissions.factoresSucursal[sucId][keyName].pendingReview;
  const valor = nivel === "empresa" ? valorEmpresa : factorFor(emissions, sucId, keyName);

  const commit = (val) => {
    setEditando(false);
    if (isNaN(val)) return;
    if (nivel === "empresa") onEmpresa(keyName, val);
    else onOverride(sucId, keyName, val);
  };

  return (
    <div className={"emis-factor-row" + (pendiente ? " pending" : "")}>
      <span
        className="emis-factor-scope"
        style={{ background: SCOPES[fdef.scope].bg, color: SCOPES[fdef.scope].color }}
      >
        A{fdef.scope}
      </span>
      <div className="emis-factor-name">
        <div style={{ font: "600 14px/1.2 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>
          {fdef.label}
        </div>
        <div className="prt-hint" style={{ fontSize: 11 }}>{fdef.fuente}</div>
      </div>

      {nivel === "suc" &&
        (propio ? (
          <Chip kind="info" size="sm" icon="edit">Personalizado</Chip>
        ) : (
          <Chip size="sm" icon="link">Heredado de empresa</Chip>
        ))}

      <div className="emis-factor-value">
        {editando ? (
          <EditorValor value={valor} unit={fdef.unit} onCommit={commit} onCancel={() => setEditando(false)} />
        ) : (
          <>
            <span style={{ font: "700 15px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>
              {valor}
            </span>
            <span className="prt-hint" style={{ fontSize: 11 }}>{fdef.unit}</span>
          </>
        )}
      </div>

      {!editando && (
        <div className="prt-row" style={{ gap: 4 }}>
          <button
            className="ob-icon-btn rc-icon-hover"
            style={{ color: "var(--rl-gray-500)" }}
            title="Editar factor"
            onClick={() => setEditando(true)}
          >
            <Icon name="edit" size={15} />
          </button>
          {propio && (
            <button
              className="ob-icon-btn rc-icon-hover"
              style={{ color: "var(--rl-gray-500)" }}
              title="Restablecer al valor de empresa"
              onClick={() => onReset(sucId, keyName)}
            >
              <Icon name="undo" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Refrigerantes({ sucId, lista, onCambiar, onQuitar, onAgregar }) {
  if (!sucId) {
    return (
      <div className="prt-hint" style={{ padding: "14px 0" }}>
        Los refrigerantes se cargan por sucursal. Selecciona una sucursal para gestionar su catálogo.
      </div>
    );
  }

  return (
    <div>
      <div className="prt-stack-sm" style={{ marginBottom: 12 }}>
        {lista.length === 0 && (
          <div className="prt-hint" style={{ padding: "10px 0" }}>
            Sin refrigerantes registrados en esta sucursal.
          </div>
        )}
        {lista.map((rf) => (
          <FilaRefrigerante
            key={rf.uid}
            rf={rf}
            onCambiar={(patch) => onCambiar(rf.uid, patch)}
            onQuitar={() => onQuitar(rf.uid)}
          />
        ))}
      </div>
      <button className="ob-add-btn sm" onClick={onAgregar}>
        <Icon name="add" size={16} />
        <span>Agregar refrigerante</span>
      </button>
    </div>
  );
}

function FilaRefrigerante({ rf, onCambiar, onQuitar }) {
  // Los kilos se editan en local y se guardan al salir del campo: guardar por
  // cada tecla escribiría la hoja completa en cada dígito.
  const [kg, setKg] = useState(String(rf.cargaKg));
  const gwp = GWP[rf.tipo] || 0;
  const tco2e = ((parseFloat(kg) || 0) * gwp) / 1000;

  return (
    <div className="emis-refrig-row">
      <span
        className="prt-kpi-ico"
        style={{ width: 34, height: 34, background: CAT_META.refrigerantes.bg, color: CAT_META.refrigerantes.color }}
      >
        <Icon name="snowflake" size={16} />
      </span>
      <Select
        style={{ width: 130 }}
        value={rf.tipo}
        onChange={(v) => onCambiar({ tipo: v })}
        options={REFRIGERANTES_CATALOG.map((r) => ({ value: r.id, label: r.label }))}
      />
      <span className="emis-gwp-pill">GWP {gwp ? gwp.toLocaleString("es-CL") : "—"}</span>
      <div className="prt-input-wrap has-suffix" style={{ width: 130 }}>
        <input
          className="prt-input"
          type="number"
          step="0.1"
          value={kg}
          style={{ height: 38 }}
          onChange={(e) => setKg(e.target.value)}
          onBlur={() => onCambiar({ cargaKg: parseFloat(kg) || 0 })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className="prt-suffix" style={{ fontSize: 11 }}>kg</span>
      </div>
      <span className="prt-hint" style={{ fontSize: 12, marginLeft: "auto" }}>
        = <strong style={{ color: "var(--rl-gray-800)" }}>{fmtTon(tco2e, 2)}</strong> tCO₂e
      </span>
      <button className="ob-icon-btn rc-icon-hover" title="Quitar" onClick={onQuitar}>
        <Icon name="delete" size={15} />
      </button>
    </div>
  );
}

const POR_ALCANCE = { 1: [], 2: [], 3: [] };
for (const [k, def] of Object.entries(EMISSION_FACTOR_CATALOG)) POR_ALCANCE[def.scope].push(k);

export function Factores({ emissions: inicial, sucursales, mesActual }) {
  const { correr, pending } = useAccion();
  const [emissions, setEmissions] = useState(inicial);
  const [ambito, setAmbito] = useState("all"); // "all" = empresa

  const sucId = ambito === "all" ? null : ambito;
  const nivel = sucId ? "suc" : "empresa";

  const guardar = (siguiente, exito) => {
    setEmissions(siguiente);
    correr(() => saveEmissionsAction(siguiente), { exito });
  };

  const setFactorEmpresa = (key, value) => {
    const def = EMISSION_FACTOR_CATALOG[key];
    const factoresEmpresa = {
      ...emissions.factoresEmpresa,
      [key]: { ...emissions.factoresEmpresa[key], value },
    };
    // Los valores propios de ese factor quedan para revisar: se definieron contra
    // un valor base que ya no es el vigente.
    const factoresSucursal = {};
    let marcados = 0;
    for (const [id, factores] of Object.entries(emissions.factoresSucursal)) {
      if (!factores[key]) {
        factoresSucursal[id] = factores;
        continue;
      }
      marcados++;
      factoresSucursal[id] = { ...factores, [key]: { ...factores[key], pendingReview: true } };
    }
    guardar(
      { ...emissions, factoresEmpresa, factoresSucursal },
      {
        title: "Factor de empresa actualizado",
        body:
          `${def.label} · ${value} ${def.unit}.` +
          (marcados > 0
            ? ` ${marcados} valor${marcados > 1 ? "es" : ""} personalizado${marcados > 1 ? "s" : ""} quedó pendiente de revisión.`
            : " Las sucursales que heredan se recalculan."),
      },
    );
  };

  const setOverride = (id, key, value) => {
    const def = EMISSION_FACTOR_CATALOG[key];
    guardar(
      {
        ...emissions,
        factoresSucursal: {
          ...emissions.factoresSucursal,
          [id]: { ...(emissions.factoresSucursal[id] || {}), [key]: { value, pendingReview: false } },
        },
      },
      { title: "Factor personalizado", body: `${def.label} ahora usa ${value} ${def.unit} en esta sucursal.` },
    );
  };

  const resetOverride = (id, key) => {
    const def = EMISSION_FACTOR_CATALOG[key];
    const { [key]: _, ...resto } = emissions.factoresSucursal[id] || {};
    guardar(
      { ...emissions, factoresSucursal: { ...emissions.factoresSucursal, [id]: resto } },
      {
        title: "Restablecido",
        body: `${def.label} vuelve al valor de empresa (${emissions.factoresEmpresa[key].value} ${def.unit}).`,
      },
    );
  };

  const marcarRevisado = (id, key) => {
    const factores = emissions.factoresSucursal[id] || {};
    if (!factores[key]) return;
    guardar({
      ...emissions,
      factoresSucursal: {
        ...emissions.factoresSucursal,
        [id]: { ...factores, [key]: { ...factores[key], pendingReview: false } },
      },
    });
  };

  const cambiarRefrig = (uid, patch) => {
    const lista = (emissions.refrigerantesSucursal[sucId] || []).map((r) =>
      r.uid === uid ? { ...r, ...patch } : r,
    );
    guardar({
      ...emissions,
      refrigerantesSucursal: { ...emissions.refrigerantesSucursal, [sucId]: lista },
    });
  };

  const quitarRefrig = (uid) => {
    const lista = (emissions.refrigerantesSucursal[sucId] || []).filter((r) => r.uid !== uid);
    guardar(
      { ...emissions, refrigerantesSucursal: { ...emissions.refrigerantesSucursal, [sucId]: lista } },
      { title: "Refrigerante eliminado" },
    );
  };

  const agregarRefrig = () => {
    const lista = [
      ...(emissions.refrigerantesSucursal[sucId] || []),
      { uid: nextRefrigId(), tipo: "r410a", cargaKg: 1, mes: mesActual },
    ];
    guardar({
      ...emissions,
      refrigerantesSucursal: { ...emissions.refrigerantesSucursal, [sucId]: lista },
    });
  };

  const pendientes = overridesPendientes({ sucursales, emissions }).filter(
    (p) => sucId == null || p.sucId === sucId,
  );

  return (
    <div>
      <SectionHead
        eyebrow="Impacto Ambiental / Configuración"
        title="Factores de emisión"
        sub="Define los factores base de la empresa según la guía Huella Chile. Cada sucursal los hereda y puede personalizarlos."
        right={
          <Link className="prt-btn" href="/impacto">
            <Icon name="arrow_back" />
            Volver al impacto
          </Link>
        }
      />

      <div className="emis-scope-switch" style={{ marginBottom: 18 }}>
        <button
          className={"emis-scope-tab" + (ambito === "all" ? " active" : "")}
          onClick={() => setAmbito("all")}
        >
          <Icon name="factory" size={16} /> Empresa (base)
        </button>
        <span className="emis-scope-sep" />
        {sucursales.map((s) => {
          const n = Object.keys(emissions.factoresSucursal[s.id] || {}).length;
          return (
            <button
              key={s.id}
              className={"emis-scope-tab" + (ambito === s.id ? " active" : "")}
              onClick={() => setAmbito(s.id)}
            >
              {s.nombre}
              {n > 0 && <span className="emis-scope-badge">{n}</span>}
            </button>
          );
        })}
      </div>

      {pendientes.length > 0 && (
        <div className="emis-alert pending" style={{ marginBottom: 18 }}>
          <span className="ico" style={{ background: "var(--rl-warning-100)", color: "var(--rl-warning-700)" }}>
            <Icon name="warning" size={20} />
          </span>
          <div className="prt-grow">
            <div className="ttl">Factor de empresa cambió — revisa tus valores personalizados</div>
            <div className="sub">
              {pendientes
                .map((p) => `${p.label} (${p.sucNombre}): empresa ${p.empValue} · tu valor ${p.sucValue} ${p.unit}`)
                .join(" · ")}
            </div>
          </div>
          {pendientes.map((p) => (
            <Btn
              key={p.sucId + p.key}
              size="sm"
              disabled={pending}
              onClick={() => marcarRevisado(p.sucId, p.key)}
            >
              Marcar revisado
            </Btn>
          ))}
        </div>
      )}

      {nivel === "empresa" && (
        <div className="emis-info-banner" style={{ marginBottom: 18 }}>
          <Icon name="info" size={16} />
          <span>
            Estos valores son la <strong>configuración base</strong>. Todas las sucursales los heredan
            salvo que definan un valor propio.
          </span>
        </div>
      )}

      <div className="prt-stack-md" style={{ marginBottom: 18 }}>
        {[1, 2, 3].map((s) => (
          <Card key={s} flush>
            <div className="prt-card-head">
              <div className="prt-row" style={{ gap: 10 }}>
                <span
                  className="emis-factor-scope"
                  style={{ background: SCOPES[s].bg, color: SCOPES[s].color }}
                >
                  A{s}
                </span>
                <div>
                  <div className="prt-h3">{SCOPES[s].label}</div>
                  <div className="prt-hint">{SCOPES[s].desc}</div>
                </div>
              </div>
            </div>
            <div style={{ padding: "6px 22px 14px" }}>
              {POR_ALCANCE[s].map((k) => (
                <FilaFactor
                  key={k}
                  keyName={k}
                  fdef={EMISSION_FACTOR_CATALOG[k]}
                  nivel={nivel}
                  sucId={sucId}
                  emissions={emissions}
                  onEmpresa={setFactorEmpresa}
                  onOverride={setOverride}
                  onReset={resetOverride}
                />
              ))}
            </div>
          </Card>
        ))}

        <Card flush>
          <div className="prt-card-head">
            <div className="prt-row" style={{ gap: 10 }}>
              <span
                className="emis-factor-scope"
                style={{ background: SCOPES[1].bg, color: SCOPES[1].color }}
              >
                A1
              </span>
              <div>
                <div className="prt-h3">Refrigerantes</div>
                <div className="prt-hint">Catálogo por GWP · fugas y recargas (Alcance 1)</div>
              </div>
            </div>
            <Chip size="sm">{REFRIGERANTES_CATALOG.length} tipos disponibles</Chip>
          </div>
          <div style={{ padding: "16px 22px 18px" }}>
            <Refrigerantes
              sucId={sucId}
              lista={sucId ? emissions.refrigerantesSucursal[sucId] || [] : []}
              onCambiar={cambiarRefrig}
              onQuitar={quitarRefrig}
              onAgregar={agregarRefrig}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
