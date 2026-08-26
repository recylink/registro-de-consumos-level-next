"use client";

// Registro móvil de lecturas: para tomar lecturas en terreno, con el teléfono en
// una mano y la linterna en la otra.
//
// Rediseñado sobre el prototipo "Registro de Consumos 1.0" (proto/medidores-movil).
// Lo que cambió respecto de la versión anterior de esta misma pantalla, y por qué:
//
//   1. Antes eran tres selectores apilados y después la lista completa de
//      medidores. En un teléfono eso es un formulario largo donde todo pesa
//      igual. Ahora es un recorrido de un paso por pantalla: sucursal → tipo →
//      mes → lecturas, y cada paso es una lista de cosas que se tocan, no un
//      campo que se despliega.
//   2. El dato con el que la persona identifica el medidor en la pared es su
//      NÚMERO, no el nombre que alguien le puso en la planilla. Así que el número
//      es lo más grande de la tarjeta y el nombre pasa a subtítulo.
//   3. Un medidor a la vez en vez de todos juntos: el que se está leyendo ocupa
//      la pantalla, y para saltar a otro hay un selector que sube desde abajo con
//      el estado de cada uno (Listo / Falta / Revisar).
//
// Lo que NO cambió, a propósito:
//
//   - El guardado sigue siendo automático (MedidoresProvider, con debounce). En
//     terreno se pierde señal y se cierra el teléfono: un botón "Guardar" al
//     final significaría perder lo tipeado. La pantalla de cierre es un resumen
//     de lo que ya se guardó, no el momento en que se guarda.
//   - La foto de respaldo sigue dentro de la tarjeta de cada medidor. El
//     prototipo no la tenía porque es anterior a esa función.
//   - El paso "tipo de consumo" se mantiene aunque el prototipo lo eliminaba:
//     decisión de Domingo, para poder recorrer solo los medidores de un tipo.
//
// La validación NO se reimplementa: es `validateReading` de lib/domain, la misma
// que usa la tabla de escritorio, así que las dos pantallas aceptan y rechazan lo
// mismo. Lo único propio de acá es cómo se muestra.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { NumericInput } from "@/components/ui/controls";
import { RespaldoUploader } from "@/components/medidores/celdas";
import { MedidoresProvider, useMedidores } from "@/components/medidores/estado";
import { IndicadorGuardado } from "@/components/medidores/guardado";
import { fmtNum, monthLabelShort } from "@/lib/domain/format";
import { MED_TYPE_OPTS, metersFor } from "@/lib/domain/medidores";
import {
  consumoFor,
  MED_TYPES,
  medUnit,
  meterReadingFor,
  prevReading,
  validateReading,
} from "@/lib/domain/medidores-calc";
import { activeSucNames } from "@/lib/domain/sucursales";

const PASOS = ["sucursal", "tipo", "mes", "lecturas"];

// Cuántos medidores hacen falta para que valga la pena un buscador en el
// selector. Por debajo, la lista se recorre con el pulgar más rápido que
// escribiendo.
const MEDIDORES_PARA_BUSCAR = 8;

/** "marzo 2026" — el mes en palabras, que es como se dice en voz alta. */
function mesLargo(mk) {
  if (!mk) return "";
  const [y, m] = mk.split("-");
  const nombres = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${nombres[parseInt(m, 10) - 1]} ${y}`;
}

/**
 * Estado de un medidor en un mes, para pintarlo en el selector y contar el
 * progreso. Se apoya en lo ya guardado, no en un borrador aparte: como el
 * guardado es automático, "lo tipeado" y "lo guardado" son la misma cosa.
 */
function estadoMedidor(M, meterId, month) {
  const lectura = meterReadingFor(M.readings, meterId, month);
  if (lectura == null) return "falta";
  const res = validateReading({ readings: M.readings, meterId, month, value: lectura });
  return res.ok ? "listo" : "revisar";
}

const ESTADO_LABEL = { listo: "Listo", falta: "Falta", revisar: "Revisar" };

function MovilInterior({ sucursales, mesActual, meses }) {
  const { M, flush } = useMedidores();
  const [paso, setPaso] = useState("sucursal");
  const [suc, setSuc] = useState(null);
  const [type, setType] = useState(null);
  const [month, setMonth] = useState(null);
  const [foco, setFoco] = useState(0);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [cierre, setCierre] = useState(null);
  const [cerrando, setCerrando] = useState(false);

  const medidores = useMemo(
    () => (suc && type ? metersFor(M, suc, type) : []),
    [M, suc, type],
  );
  const unidad = medUnit(type);
  const meta = MED_TYPES[type] || null;

  // Los 6 meses más recientes, el más nuevo arriba: en terreno se registra el mes
  // que acaba de cerrar, no uno de hace un año.
  const mesesRecientes = useMemo(() => meses.slice(-6).slice().reverse(), [meses]);

  const listos = medidores.filter((m) => estadoMedidor(M, m.id, month) === "listo").length;
  const porRevisar = medidores.filter((m) => estadoMedidor(M, m.id, month) === "revisar").length;
  const idxPaso = PASOS.indexOf(paso);

  // Al entrar a las lecturas, partir por el primer medidor sin registrar: si se
  // vuelve a una selección a medio terminar, el foco cae donde quedó el trabajo.
  useEffect(() => {
    if (paso !== "lecturas" || !medidores.length) return;
    const i = medidores.findIndex((m) => estadoMedidor(M, m.id, month) === "falta");
    setFoco(i === -1 ? 0 : i);
    setSelectorAbierto(false);
    setBusqueda("");
    // Solo al llegar al paso o cambiar de selección — no en cada tecleo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, suc, type, month]);

  const atras = () => {
    if (paso === "sucursal") return;
    setPaso(PASOS[idxPaso - 1]);
  };

  // Cerrar no guarda: lo guardado ya está. Solo empuja lo que quede en la ventana
  // del debounce y muestra el resumen, para que nadie se vaya con la duda.
  const cerrar = async () => {
    setCerrando(true);
    try {
      await flush();
    } catch {
      // El indicador de guardado ya reporta el error y ofrece reintentar; el
      // resumen se muestra igual para no dejar la pantalla trabada.
    }
    setCerrando(false);
    setCierre({ registradas: listos, total: medidores.length, suc, type, month });
    setPaso("cierre");
  };

  if (paso === "cierre" && cierre) {
    return (
      <Cierre
        datos={cierre}
        onOtroMes={() => {
          setCierre(null);
          setMonth(null);
          setPaso("mes");
        }}
      />
    );
  }

  return (
    <div className="rc-mv">
      <header className="rc-mv-appbar">
        {paso === "sucursal" ? (
          <Link className="rc-mv-back" href="/medidores" aria-label="Volver a medidores">
            <Icon name="chevron_left" size={22} />
          </Link>
        ) : (
          <button type="button" className="rc-mv-back" onClick={atras} aria-label="Paso anterior">
            <Icon name="chevron_left" size={22} />
          </button>
        )}
        <div className="rc-mv-appbar-title">
          <span className="t">Registrar lecturas</span>
          <span className="s">Paso {idxPaso + 1} de {PASOS.length}</span>
        </div>
        <div className="rc-mv-dots" aria-hidden="true">
          {PASOS.map((p, i) => (
            <span key={p} className={"dot" + (i <= idxPaso ? " on" : "")} />
          ))}
        </div>
      </header>

      <div className="rc-mv-body">
        {paso === "sucursal" && (
          <ListaPaso
            titulo="¿En qué sucursal estás?"
            items={activeSucNames(sucursales).map((n) => ({
              key: n,
              label: n,
              icon: "apartment",
              sub: `${(M.meters || []).filter((m) => m.sucursal === n && m.activo).length} medidores activos`,
            }))}
            vacio={{
              icon: "apartment",
              titulo: "Sin sucursales activas",
              body: "Activa una sucursal en Configuración para registrar lecturas.",
            }}
            onElegir={(k) => {
              setSuc(k);
              setPaso("tipo");
            }}
          />
        )}

        {paso === "tipo" && (
          <ListaPaso
            titulo="¿Qué vas a leer?"
            miga={suc}
            items={MED_TYPE_OPTS.map((t) => {
              const n = metersFor(M, suc, t.value).length;
              return {
                key: t.value,
                label: t.label,
                icon: t.icon,
                iconBg: t.iconBg,
                iconColor: t.iconColor,
                sub: n === 0 ? "Sin medidores acá" : `${n} medidor${n === 1 ? "" : "es"}`,
                deshabilitado: n === 0,
              };
            })}
            onElegir={(k) => {
              setType(k);
              setPaso("mes");
            }}
          />
        )}

        {paso === "mes" && (
          <ListaPaso
            titulo="¿Qué mes vas a registrar?"
            miga={`${suc} · ${meta ? meta.label : ""}`}
            items={mesesRecientes.map((mk) => {
              const conLectura = medidores.filter(
                (m) => meterReadingFor(M.readings, m.id, mk) != null,
              ).length;
              return {
                key: mk,
                label: mesLargo(mk),
                icon: "calendar_month",
                sub:
                  conLectura === 0
                    ? "Sin registrar"
                    : `${conLectura} de ${medidores.length} ya registrados`,
                tag: mk === mesActual ? "Mes actual" : conLectura ? "Empezado" : null,
              };
            })}
            onElegir={(k) => {
              setMonth(k);
              setPaso("lecturas");
            }}
          />
        )}

        {paso === "lecturas" && (
          <div>
            <div className="rc-mv-contexto">
              <div>
                <div className="suc">{suc}</div>
                <div className="mes">
                  {meta ? meta.label : ""} · {mesLargo(month)}
                </div>
              </div>
              <button type="button" onClick={() => setPaso("mes")}>
                Cambiar
              </button>
            </div>

            {medidores.length === 0 ? (
              <Vacio
                icon="speed"
                titulo="Sin medidores para esta selección"
                body="Créalos desde la vista de escritorio y vuelve acá."
              />
            ) : (
              <MedidorEnFoco
                medidores={medidores}
                foco={Math.min(foco, medidores.length - 1)}
                setFoco={setFoco}
                month={month}
                unidad={unidad}
                meta={meta}
                listos={listos}
                onAbrirSelector={() => {
                  setBusqueda("");
                  setSelectorAbierto(true);
                }}
              />
            )}
          </div>
        )}
      </div>

      {paso === "lecturas" && medidores.length > 0 && (
        <footer className="rc-mv-actionbar">
          <div className="rc-mv-actionbar-info">
            {porRevisar > 0 ? (
              <span className="err">
                <Icon name="error" size={15} /> {porRevisar} por revisar
              </span>
            ) : (
              <IndicadorGuardado compact />
            )}
          </div>
          <button type="button" className="rc-mv-cta" onClick={cerrar} disabled={cerrando}>
            {cerrando ? <span className="prt-spinner" /> : null}
            {cerrando ? "Guardando…" : "Listo"}
          </button>
        </footer>
      )}

      {selectorAbierto && medidores.length > 0 && (
        <SelectorMedidor
          medidores={medidores}
          month={month}
          foco={foco}
          busqueda={busqueda}
          setBusqueda={setBusqueda}
          onElegir={(i) => {
            setFoco(i);
            setSelectorAbierto(false);
          }}
          onCerrar={() => setSelectorAbierto(false)}
        />
      )}
    </div>
  );
}

/** Un paso de selección: título y una lista de cosas que se tocan. */
function ListaPaso({ titulo, miga, items, onElegir, vacio }) {
  return (
    <div className="rc-mv-pick">
      {miga && (
        <div className="rc-mv-miga">
          <Icon name="apartment" size={13} /> {miga}
        </div>
      )}
      <h2 className="rc-mv-pick-titulo">{titulo}</h2>
      {items.length === 0 && vacio ? (
        <Vacio {...vacio} />
      ) : (
        <div className="rc-mv-pick-lista">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              className="rc-mv-pick-item"
              disabled={it.deshabilitado}
              onClick={() => onElegir(it.key)}
            >
              <span
                className="rc-mv-pick-ico"
                style={it.iconBg ? { background: it.iconBg, color: it.iconColor } : undefined}
              >
                <Icon name={it.icon} size={20} />
              </span>
              <span className="rc-mv-pick-text">
                <span className="lbl">{it.label}</span>
                <span className="sub">{it.sub}</span>
              </span>
              {it.tag && <span className="rc-mv-pick-tag">{it.tag}</span>}
              <Icon name="chevron_right" size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * El medidor que se está leyendo ahora: su número en grande, la lectura anterior
 * como referencia, el campo, y la foto de respaldo.
 */
function MedidorEnFoco({ medidores, foco, setFoco, month, unidad, meta, listos, onAbrirSelector }) {
  const m = medidores[foco];
  const pct = medidores.length ? (listos / medidores.length) * 100 : 0;

  return (
    <>
      <button type="button" className="rc-mv-selector" onClick={onAbrirSelector}>
        <span
          className="rc-mv-selector-ico"
          style={meta ? { background: meta.bg, color: meta.color } : undefined}
        >
          <Icon name={meta ? meta.icon : "speed"} size={22} />
        </span>
        <span className="rc-mv-selector-text">
          <span className="eyebrow">Estás registrando</span>
          <span className="name">{m.numero ? `N° ${m.numero}` : m.nombre}</span>
          {m.numero && <span className="sub">{m.nombre}</span>}
        </span>
        <span className="rc-mv-selector-cta">
          Cambiar <Icon name="chevron_right" size={16} />
        </span>
      </button>

      <div className="rc-mv-progreso">
        <span className="count">
          {listos} de {medidores.length}
        </span>
        <span className="bar">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span>listos</span>
      </div>

      <TarjetaMedidor key={m.id + month} medidor={m} month={month} unidad={unidad} />

      <div className="rc-mv-nav">
        <button
          type="button"
          className="rc-mv-nav-btn"
          disabled={foco === 0}
          onClick={() => setFoco(Math.max(0, foco - 1))}
        >
          <Icon name="chevron_left" size={18} /> Anterior
        </button>
        <span className="rc-mv-nav-pos">
          {foco + 1} de {medidores.length}
        </span>
        <button
          type="button"
          className="rc-mv-nav-btn"
          disabled={foco >= medidores.length - 1}
          onClick={() => setFoco(Math.min(medidores.length - 1, foco + 1))}
        >
          Siguiente <Icon name="chevron_right" size={18} />
        </button>
      </div>
    </>
  );
}

/**
 * La tarjeta con el campo de lectura. No usa `LecturaCell`: esa está hecha para
 * una celda de tabla de 34 px con el mensaje reducido a un ícono, y acá la
 * lectura es el dato principal de la pantalla. La lógica sí es la misma —
 * `validateReading` y `setReading` del provider.
 */
function TarjetaMedidor({ medidor, month, unidad }) {
  const { M, setReading } = useMedidores();
  // El mensaje pertenece al medidor que se está mirando. No hace falta limpiarlo
  // a mano: quien renderiza esta tarjeta le pasa key={medidor.id + month}, así
  // que al saltar de medidor React la remonta y el estado nace vacío.
  const [msg, setMsg] = useState(null);
  const guardada = meterReadingFor(M.readings, medidor.id, month);
  const anterior = prevReading(M.readings, medidor.id, month);
  const consumo = consumoFor(M.readings, medidor.id, month);

  const onChange = (v) => {
    const res = validateReading({ readings: M.readings, meterId: medidor.id, month, value: v });
    setMsg(res.error ? { kind: "error", text: res.error } : res.warn ? { kind: "warn", text: res.warn } : null);
    // Una lectura rechazada no se guarda: el mensaje explica por qué.
    if (res.ok) setReading({ meterId: medidor.id, month, lectura: v });
  };

  const conError = msg && msg.kind === "error";

  return (
    <div className={"rc-mv-medidor" + (conError ? " err" : "")}>
      <div className="rc-mv-medidor-id">
        {medidor.numero ? (
          <>
            <span className="num">
              <span className="lbl">N°</span>
              {medidor.numero}
            </span>
            <span className="nombre">{medidor.nombre}</span>
          </>
        ) : (
          <span className="num sin-numero">{medidor.nombre}</span>
        )}
      </div>

      <div className="rc-mv-medidor-prev">
        {anterior ? (
          <>
            Lectura anterior · <strong>{fmtNum(Number(anterior.lectura))} {unidad}</strong>{" "}
            <span className="m">({monthLabelShort(anterior.month)})</span>
          </>
        ) : (
          <span className="ninguna">Sin lectura previa — esta será la inicial</span>
        )}
      </div>

      <div className="rc-mv-input-row">
        <NumericInput
          value={guardada == null ? "" : guardada}
          onChange={onChange}
          placeholder="Ingresa la lectura"
          suffix={unidad}
          error={!!conError}
          style={{ height: 56, fontSize: 26, fontWeight: 700, textAlign: "left" }}
        />
      </div>

      {msg ? (
        <div className={"rc-mv-feedback " + msg.kind}>
          <Icon name={msg.kind === "error" ? "error" : "warning"} size={14} />
          {msg.text}
        </div>
      ) : consumo != null ? (
        <div className="rc-mv-feedback ok">
          <Icon name="check_circle" size={14} fill />
          Consumo: {fmtNum(consumo)} {unidad}
        </div>
      ) : guardada != null ? (
        <div className="rc-mv-feedback first">
          <Icon name="info" size={14} />
          Lectura inicial — todavía sin consumo
        </div>
      ) : null}

      <div className="rc-mv-medidor-respaldo">
        <RespaldoUploader meterId={medidor.id} month={month} />
      </div>
    </div>
  );
}

/** Hoja que sube desde abajo para saltar de medidor, con su estado. */
function SelectorMedidor({ medidores, month, foco, busqueda, setBusqueda, onElegir, onCerrar }) {
  const { M } = useMedidores();
  const q = busqueda.trim().toLowerCase();
  const filtrados = medidores
    .map((m, i) => ({ m, i }))
    .filter(
      ({ m }) =>
        !q ||
        String(m.numero || "").toLowerCase().includes(q) ||
        String(m.nombre || "").toLowerCase().includes(q),
    );

  return (
    <div className="rc-mv-sheet" onClick={onCerrar} role="dialog" aria-modal="true">
      <div className="rc-mv-sheet-inner" onClick={(e) => e.stopPropagation()}>
        <div className="rc-mv-sheet-head">
          <div className="rc-mv-sheet-grabber" />
          <div className="rc-mv-sheet-titulo">Elige el medidor</div>
          <div className="rc-mv-sheet-sub">Toca el que estás viendo ahora</div>
          {medidores.length > MEDIDORES_PARA_BUSCAR && (
            <input
              className="rc-mv-buscar"
              type="text"
              placeholder="Buscar por número o nombre"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          )}
        </div>
        <div className="rc-mv-sheet-lista">
          {filtrados.length === 0 ? (
            <div className="rc-mv-sheet-nada">Ningún medidor coincide con “{busqueda}”.</div>
          ) : (
            filtrados.map(({ m, i }) => {
              const est = estadoMedidor(M, m.id, month);
              const tipo = MED_TYPES[m.type];
              return (
                <button
                  key={m.id}
                  type="button"
                  className={"rc-mv-sheet-row" + (i === foco ? " on" : "")}
                  onClick={() => onElegir(i)}
                >
                  <span
                    className="ico"
                    style={tipo ? { background: tipo.bg, color: tipo.color } : undefined}
                  >
                    <Icon name={tipo ? tipo.icon : "speed"} size={20} />
                  </span>
                  <span className="text">
                    <span className="name">{m.numero ? `N° ${m.numero}` : m.nombre}</span>
                    <span className="sub">{m.numero ? m.nombre : tipo ? tipo.label : ""}</span>
                  </span>
                  <span className={"estado " + est}>{ESTADO_LABEL[est]}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** Resumen de lo que quedó guardado. No guarda nada: eso ya pasó. */
function Cierre({ datos, onOtroMes }) {
  const { registradas, total, suc, type, month } = datos;
  const meta = MED_TYPES[type];
  const faltan = total - registradas;

  return (
    <div className="rc-mv-cierre">
      <div className={"rc-mv-cierre-check" + (faltan > 0 ? " parcial" : "")}>
        <Icon name={faltan > 0 ? "schedule" : "check"} size={34} />
      </div>
      <div className="rc-mv-cierre-titulo">
        {faltan > 0 ? "Guardado, pero quedan medidores" : "¡Lecturas guardadas!"}
      </div>
      <div className="rc-mv-cierre-sub">
        <strong>{registradas}</strong> de {total} medidor{total === 1 ? "" : "es"} registrado
        {registradas === 1 ? "" : "s"} en
        <br />
        <strong>{suc}</strong> · {meta ? meta.label : ""} · {mesLargo(month)}
      </div>
      {faltan > 0 && (
        <div className="rc-mv-cierre-aviso">
          Faltan {faltan}. Puedes volver cuando quieras: lo registrado ya está en la planilla.
        </div>
      )}
      <div className="rc-mv-cierre-guardado">
        <IndicadorGuardado compact />
      </div>
      <div className="rc-mv-cierre-acciones">
        <button type="button" className="rc-mv-cta" onClick={onOtroMes}>
          Registrar otro mes
        </button>
        <Link className="rc-mv-ghost" href="/medidores">
          Volver a medidores
        </Link>
      </div>
    </div>
  );
}

function Vacio({ icon, titulo, body }) {
  return (
    <div className="rc-mv-vacio">
      <Icon name={icon} size={40} />
      <div className="t">{titulo}</div>
      <div className="s">{body}</div>
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
