"use client";

// Pestañas de tabla del módulo Medidores: Matriz (medidores × meses), Mensual
// (un mes en detalle) y Pagos (estado de documentos). Portado de
// proto/medidores.jsx.
//
// `records` son los registros globales (las boletas), que entran como prop desde
// el servidor: sirven para la fila "Total boleta" contra la que se compara la
// suma de los medidores.

import { Fragment } from "react";
import { Icon } from "@/components/icons";
import { Card, Chip } from "@/components/ui/layout";
import { DocButton, LecturaCell, MedNoFactTip, MedPriceInput } from "@/components/medidores/celdas";
import { useMedidores } from "@/components/medidores/estado";
import { fmtCLP, fmtNum, monthLabelShort } from "@/lib/domain/format";
import {
  consumoFor,
  costoFor,
  isFirstReading,
  medFacturable,
  medUnit,
  meterReadingFor,
  monthTotals,
  PAY_CHIP,
  PAY_LABEL,
  payStatus,
} from "@/lib/domain/medidores-calc";

function NombreMedidor({ m }) {
  return (
    <>
      <strong>{m.nombre}</strong>
      {m.numero && <span className="rc-med-num">N° {m.numero}</span>}
    </>
  );
}

/** Consumo del mes, o "inicial" si es la primera lectura del medidor. */
function CeldaConsumo({ readings, meter, month, unit }) {
  const primera = meterReadingFor(readings, meter.id, month) != null && isFirstReading(readings, meter.id, month);
  const cons = consumoFor(readings, meter.id, month);
  return (
    <td className="rc-med-num-cell">
      {primera ? (
        <span className="rc-med-hint">inicial</span>
      ) : cons == null ? (
        "—"
      ) : (
        <span>
          {fmtNum(cons)} <em>{unit}</em>
        </span>
      )}
    </td>
  );
}

const FILAS_TOTAL = [
  { key: "totalMedidores", label: "Total medidores" },
  { key: "totalBoleta", label: "Total boleta" },
  { key: "diferencia", label: "Diferencia" },
];

/** Clase de color de una diferencia: bajo $1 se considera cuadrada. */
const claseDif = (dif) => (Math.abs(dif) < 1 ? "ok" : dif > 0 ? "pos" : "neg");

export function MatrizTab({ suc, type, meters, monthsView, records }) {
  const { M } = useMedidores();
  const u = medUnit(type);
  const noFacturables = meters.filter((m) => !medFacturable(m));

  return (
    <Card flush>
      <div style={{ overflowX: "auto" }}>
        <table className="prt-table rc-med-matriz">
          <thead>
            <tr>
              <th className="rc-med-sticky" style={{ minWidth: 200, textAlign: "left" }}>
                Medidor
              </th>
              {monthsView.map((mk) => (
                <th key={mk} colSpan={4} className="rc-med-monthgroup">
                  {monthLabelShort(mk)}
                </th>
              ))}
            </tr>
            <tr className="rc-med-subhead">
              <th className="rc-med-sticky" />
              {monthsView.map((mk) => (
                <Fragment key={mk}>
                  <th>Lectura</th>
                  <th>Consumo</th>
                  <th>Costo</th>
                  <th>Docs</th>
                </Fragment>
              ))}
            </tr>
            <tr className="rc-med-pricerow">
              <th className="rc-med-sticky">
                Precio <em>$/{u}</em>
              </th>
              {monthsView.map((mk) => (
                <th key={mk} colSpan={4}>
                  <MedPriceInput suc={suc} type={type} month={mk} monthsView={monthsView} compact />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meters.map((m) => (
              <tr key={m.id}>
                <td className="rc-med-sticky">
                  <NombreMedidor m={m} />
                </td>
                {monthsView.map((mk) => {
                  const costo = costoFor(M.readings, M.prices, m, mk);
                  return (
                    <Fragment key={mk}>
                      <td style={{ minWidth: 96 }}>
                        <LecturaCell meterId={m.id} month={mk} />
                      </td>
                      <CeldaConsumo readings={M.readings} meter={m} month={mk} unit={u} />
                      <td className="rc-med-num-cell">{costo == null ? "—" : fmtCLP(costo)}</td>
                      <td className="rc-med-doc-cell">
                        <div className="rc-med-doc-pair">
                          <DocButton meterId={m.id} month={mk} kind="factura" compact />
                          <DocButton meterId={m.id} month={mk} kind="pago" compact />
                          <DocButton meterId={m.id} month={mk} kind="respaldo" compact />
                        </div>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {FILAS_TOTAL.map((fila) => (
              <tr key={fila.key} className={"rc-med-foot " + fila.key}>
                <td className="rc-med-sticky">
                  {fila.label}
                  {fila.key === "totalMedidores" && noFacturables.length > 0 && (
                    <MedNoFactTip meters={noFacturables} />
                  )}
                </td>
                {monthsView.map((mk) => {
                  const t = monthTotals(meters, M.readings, M.prices, records, suc, type, mk);
                  let contenido;
                  let cls = "";
                  if (fila.key === "totalMedidores") {
                    contenido = t.totalMedidores == null ? "—" : fmtCLP(t.totalMedidores);
                  } else if (fila.key === "totalBoleta") {
                    contenido =
                      t.totalBoleta == null ? (
                        <span className="rc-med-hint" title="No hay consumo global registrado para este mes">
                          <Icon name="warning" size={12} /> falta
                        </span>
                      ) : (
                        fmtCLP(t.totalBoleta)
                      );
                  } else if (t.diferencia == null) {
                    contenido = "—";
                  } else {
                    cls = claseDif(t.diferencia);
                    contenido = (t.diferencia > 0 ? "+" : "") + fmtCLP(t.diferencia);
                  }
                  return (
                    <td key={mk} colSpan={4} className={"rc-med-num-cell " + cls}>
                      {contenido}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

export function MensualTab({ suc, type, meters, month, records }) {
  const { M } = useMedidores();
  const u = medUnit(type);
  const totals = monthTotals(meters, M.readings, M.prices, records, suc, type, month);

  return (
    <Card flush>
      <div className="rc-med-mensual-price">
        <span className="rc-med-tb-label">Precio unitario · {monthLabelShort(month)}</span>
        <div style={{ width: 160 }}>
          <MedPriceInput suc={suc} type={type} month={month} />
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="prt-table rc-med-mensual">
          <thead>
            <tr>
              <th style={{ minWidth: 180, textAlign: "left" }}>Medidor</th>
              <th style={{ textAlign: "right" }}>Lectura</th>
              <th style={{ textAlign: "right" }}>Consumo</th>
              <th style={{ textAlign: "right" }}>Costo</th>
              <th style={{ textAlign: "center" }}>Estado</th>
              <th style={{ minWidth: 230 }}>Documentos</th>
            </tr>
          </thead>
          <tbody>
            {meters.map((m) => {
              const costo = costoFor(M.readings, M.prices, m, month);
              const st = payStatus(M.docs, m.id, month);
              return (
                <tr key={m.id}>
                  <td>
                    <NombreMedidor m={m} />
                  </td>
                  <td style={{ width: 130 }}>
                    <LecturaCell meterId={m.id} month={month} />
                  </td>
                  <CeldaConsumo readings={M.readings} meter={m} month={month} unit={u} />
                  <td className="rc-med-num-cell">{costo == null ? "—" : fmtCLP(costo)}</td>
                  <td style={{ textAlign: "center" }}>
                    {!medFacturable(m) ? (
                      <Chip kind="warning" size="sm" icon="money_off">
                        No se factura
                      </Chip>
                    ) : (
                      <Chip kind={PAY_CHIP[st]} size="sm">
                        {PAY_LABEL[st]}
                      </Chip>
                    )}
                  </td>
                  <td>
                    <div className="rc-med-doc-pair full">
                      <DocButton meterId={m.id} month={month} kind="factura" />
                      <DocButton meterId={m.id} month={month} kind="pago" />
                      <DocButton meterId={m.id} month={month} kind="respaldo" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Total medidores a la izquierda · boleta y diferencia a la derecha. */}
      <div className="rc-med-summary">
        <div className="rc-med-summary-left">
          <span className="rc-med-summary-label">Total medidores</span>
          <span className="rc-med-summary-val">
            {totals.totalMedidores == null ? "—" : fmtCLP(totals.totalMedidores)}
          </span>
        </div>
        <div className="rc-med-summary-right">
          <div className="rc-med-summary-item">
            <span className="rc-med-summary-label">Boleta registrada</span>
            <span className="rc-med-summary-val">
              {totals.totalBoleta == null ? (
                <span className="rc-med-hint">
                  <Icon name="warning" size={13} /> Sin dato
                </span>
              ) : (
                fmtCLP(totals.totalBoleta)
              )}
            </span>
          </div>
          <span className="rc-med-tb-divider" aria-hidden="true" />
          <div className="rc-med-summary-item">
            <span className="rc-med-summary-label">Diferencia</span>
            <span
              className={
                "rc-med-summary-val " + (totals.diferencia == null ? "" : claseDif(totals.diferencia))
              }
            >
              {totals.diferencia == null
                ? "—"
                : (totals.diferencia > 0 ? "+" : "") + fmtCLP(totals.diferencia)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function PagosTab({ meters, monthsView }) {
  const { M } = useMedidores();

  return (
    <Card flush>
      <div style={{ overflowX: "auto" }}>
        <table className="prt-table rc-med-pagos">
          <thead>
            <tr>
              <th className="rc-med-sticky" style={{ minWidth: 200, textAlign: "left" }}>
                Medidor
              </th>
              {monthsView.map((mk) => (
                <th key={mk} style={{ textAlign: "center" }}>
                  {monthLabelShort(mk)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meters.map((m) => (
              <tr key={m.id}>
                <td className="rc-med-sticky">
                  <NombreMedidor m={m} />
                </td>
                {!medFacturable(m) ? (
                  <td colSpan={monthsView.length} style={{ textAlign: "center" }}>
                    <Chip kind="warning" size="sm" icon="money_off">
                      Configurado para no ser facturado
                    </Chip>
                  </td>
                ) : (
                  monthsView.map((mk) => (
                    <td key={mk} style={{ textAlign: "center" }}>
                      <Chip kind={PAY_CHIP[payStatus(M.docs, m.id, mk)]} size="sm">
                        {PAY_LABEL[payStatus(M.docs, m.id, mk)]}
                      </Chip>
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
