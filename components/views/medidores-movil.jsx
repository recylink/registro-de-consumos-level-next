"use client";

// Registro móvil de lecturas. Portado de MedidoresMobileView en
// proto/medidores.jsx: una tarjeta por medidor con la lectura del mes, el consumo
// calculado y la foto de respaldo.
//
// Comparte el estado y el guardado automático de la vista de escritorio
// (MedidoresProvider), pero es su propia ruta: /medidores/movil.

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Select } from "@/components/ui/controls";
import { EmptyState, Field } from "@/components/ui/layout";
import { LecturaCell, RespaldoUploader } from "@/components/medidores/celdas";
import { MedidoresProvider, useMedidores } from "@/components/medidores/estado";
import { fmtNum, monthLabelShort } from "@/lib/domain/format";
import { MED_TYPE_OPTS, metersFor } from "@/lib/domain/medidores";
import { consumoFor, isFirstReading, medUnit, meterReadingFor } from "@/lib/domain/medidores-calc";
import { activeSucNames } from "@/lib/domain/sucursales";

function MovilInterior({ sucursales, mesActual, meses }) {
  const { M, guardando } = useMedidores();
  const [suc, setSuc] = useState("");
  const [type, setType] = useState("");
  const [month, setMonth] = useState(mesActual);

  const listo = !!(suc && type);
  const meters = listo ? metersFor(M, suc, type) : [];
  const unidad = medUnit(type);
  const opcionesMes = meses.map((mk) => ({ value: mk, label: monthLabelShort(mk) }));

  return (
    <div className="rc-med-mobile">
      <div className="rc-med-mobile-head">
        <Link className="prt-btn ghost sm" href="/medidores">
          <Icon name="arrow_back" />
          Volver
        </Link>
        <span className="prt-eyebrow">Registro móvil</span>
      </div>
      <h1 className="prt-h1" style={{ margin: "4px 0 14px" }}>
        Cargar lecturas
      </h1>

      <Field label="Sucursal">
        <Select
          value={suc}
          onChange={setSuc}
          options={activeSucNames(sucursales).map((n) => ({ value: n, label: n }))}
          placeholder="Sucursal"
        />
      </Field>
      <Field label="Tipo de consumo">
        <Select value={type} onChange={setType} options={MED_TYPE_OPTS} placeholder="Tipo" />
      </Field>
      <Field label="Mes">
        <Select value={month} onChange={setMonth} options={opcionesMes} />
      </Field>

      {!listo ? (
        <EmptyState
          icon="speed"
          title="Elige sucursal, tipo y mes"
          body="Selecciona arriba para ver los medidores a registrar."
        />
      ) : meters.length === 0 ? (
        <EmptyState
          icon="speed"
          title="Sin medidores"
          body="No hay medidores activos para esta selección. Créalos desde la vista de escritorio."
        />
      ) : (
        <div className="rc-med-mobile-list">
          {meters.map((m) => {
            const primera =
              meterReadingFor(M.readings, m.id, month) != null && isFirstReading(M.readings, m.id, month);
            const cons = consumoFor(M.readings, m.id, month);
            return (
              <div key={m.id} className="rc-med-mobile-item">
                <div className="rc-med-mobile-item-head">
                  <strong>{m.nombre}</strong>
                  {m.numero && <span className="rc-med-num">N° {m.numero}</span>}
                </div>
                <div className="rc-med-mobile-item-body">
                  <Field label="Lectura" style={{ flex: 1, marginBottom: 0 }}>
                    <LecturaCell meterId={m.id} month={month} />
                  </Field>
                  <div className="rc-med-mobile-cons">
                    {primera ? (
                      <span className="rc-med-hint">inicial</span>
                    ) : cons == null ? (
                      <span className="rc-med-hint">—</span>
                    ) : (
                      <span>
                        {fmtNum(cons)} {unidad}
                      </span>
                    )}
                  </div>
                </div>
                <div className="rc-med-mobile-respaldo">
                  <RespaldoUploader meterId={m.id} month={month} />
                </div>
              </div>
            );
          })}
          <div
            className="prt-hint"
            style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}
          >
            {guardando ? (
              <>
                <span className="prt-spinner" /> Guardando…
              </>
            ) : (
              <>
                <Icon name="check" size={14} /> Las lecturas se guardan automáticamente.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MedidoresMovil({ medidores, sucursales, mesActual, meses }) {
  return (
    <MedidoresProvider inicial={medidores}>
      <MovilInterior sucursales={sucursales} mesActual={mesActual} meses={meses} />
    </MedidoresProvider>
  );
}
