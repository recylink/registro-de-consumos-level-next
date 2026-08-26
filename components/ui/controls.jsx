"use client";

// Controles con estado o manejadores propios. Portados desde
// proto/primitives.jsx; el comportamiento no cambia (formato chileno de números,
// popovers que cierran con Esc y click afuera, menú de Select en portal).
//
// Se aprovecha que React 19 pasa `ref` como prop normal: ya no hace falta
// forwardRef, que era lo que obligaba el React 18 del prototipo.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { currentMonthISO, todayISO } from "@/lib/domain/today";

/**
 * Ayuda contextual: un ícono de información que al pasar por encima —o al tocar,
 * en un teléfono— muestra una explicación.
 *
 * El globo se dibuja en <body> con un portal y posición fija, y no dentro del
 * flujo. Un tooltip posicionado en el flujo queda recortado por cualquier
 * ancestro con `overflow` distinto de visible, y el caso que lo destapó es
 * justamente ese: el encabezado de una tabla ancha, que vive dentro de un
 * contenedor con scroll horizontal. Salir a <body> también lo libra de heredar
 * estilos del ancestro — en un <th> el texto salía en mayúsculas y a 11px.
 */
export function Ayuda({ children, ancho = 280 }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  const mostrar = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Centrado en el ícono, pero sin salirse por los costados de la ventana.
    const margen = 8;
    const medio = r.left + r.width / 2;
    const min = ancho / 2 + margen;
    const max = window.innerWidth - ancho / 2 - margen;
    setPos({ top: r.bottom + 8, left: Math.min(Math.max(medio, min), Math.max(min, max)) });
  };

  const ocultar = () => setPos(null);

  return (
    <span
      ref={ref}
      className="rc-ayuda"
      tabIndex={0}
      role="button"
      aria-label="Ayuda"
      onMouseEnter={mostrar}
      onMouseLeave={ocultar}
      onFocus={mostrar}
      onBlur={ocultar}
      // En un teléfono no hay "pasar por encima": se toca para abrir y cerrar.
      // El stopPropagation evita que el toque active además la celda de abajo.
      onClick={(e) => {
        e.stopPropagation();
        pos ? ocultar() : mostrar();
      }}
    >
      <Icon name="info" size={13} />
      {pos &&
        createPortal(
          <span className="rc-ayuda-globo" style={{ top: pos.top, left: pos.left, width: ancho }}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}

export function Btn({
  children, kind, size, icon, iconRight, onClick, disabled, style,
  type = "button", title,
}) {
  return (
    <button
      type={type}
      className={
        "prt-btn" + (kind ? " " + kind : "") + (size ? " " + size : "") + (disabled ? " disabled" : "")
      }
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={style}
      title={title}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
}

export function Input({
  value, onChange, placeholder, suffix, error, type = "text",
  autoFocus, onBlur, onKeyDown, style, min, max, ref,
}) {
  return (
    <div className={"prt-input-wrap" + (suffix ? " has-suffix" : "")}>
      <input
        ref={ref}
        type={type}
        className={"prt-input" + (error ? " error" : "")}
        value={value || ""}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        style={style}
        min={min}
        max={max}
      />
      {suffix && <span className="prt-suffix">{suffix}</span>}
    </div>
  );
}

/**
 * Input numérico en formato chileno. Bloquea el punto (lo pone el componente
 * como separador de miles), acepta una coma decimal, no formatea mientras se
 * escribe (evita saltos del cursor) y emite NÚMERO, no string.
 */
export function NumericInput({
  value, onChange, placeholder, suffix, error, autoFocus, onBlur, style,
  allowDecimal = true, ref,
}) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");

  const formatDisplay = (n) => {
    if (n === "" || n == null) return "";
    const num = typeof n === "number" ? n : parseFloat(String(n).replace(/\./g, "").replace(",", "."));
    if (isNaN(num)) return "";
    return num.toLocaleString("es-CL", { maximumFractionDigits: 6 });
  };

  const parseUserInput = (s) => {
    if (s == null) return "";
    const t = String(s).trim();
    if (!t || t === "-" || t === ",") return "";
    const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? "" : n;
  };

  const display = focused ? raw : formatDisplay(value);

  const onChangeRaw = (e) => {
    let v = e.target.value.replace(/\./g, "");
    v = allowDecimal ? v.replace(/[^0-9,-]/g, "") : v.replace(/[^0-9-]/g, "");
    const firstComma = v.indexOf(",");
    if (firstComma !== -1) {
      v = v.slice(0, firstComma + 1) + v.slice(firstComma + 1).replace(/,/g, "");
    }
    if (v.indexOf("-") > 0) v = v.replace(/-/g, "");
    setRaw(v);
    onChange && onChange(parseUserInput(v));
  };

  const onKeyDownGuard = (e) => {
    if (e.key === ".") e.preventDefault();
    else if (!allowDecimal && e.key === ",") e.preventDefault();
  };

  const handleFocus = () => {
    setFocused(true);
    if (value === "" || value == null) {
      setRaw("");
      return;
    }
    const num = typeof value === "number" ? value : parseFloat(String(value).replace(/\./g, "").replace(",", "."));
    setRaw(isNaN(num) ? "" : String(num).replace(".", ","));
  };

  const handleBlur = (e) => {
    setFocused(false);
    if (onBlur) onBlur(e);
  };

  return (
    <div className={"prt-input-wrap" + (suffix ? " has-suffix" : "")}>
      <input
        ref={ref}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        className={"prt-input" + (error ? " error" : "")}
        value={display}
        onChange={onChangeRaw}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={onKeyDownGuard}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={style}
      />
      {suffix && <span className="prt-suffix">{suffix}</span>}
    </div>
  );
}

// Cierra un popover con click afuera o Esc.
function useDismiss(open, rootRef, onDismiss, deps = []) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onDismiss();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
}

const POPOVER = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  zIndex: 30,
  background: "#fff",
  border: "1px solid var(--rl-gray-200)",
  borderRadius: 12,
  boxShadow: "0 16px 36px rgba(16,24,40,0.12)",
  padding: 14,
};

const NAV_BTN = {
  all: "unset",
  cursor: "pointer",
  width: 32,
  height: 32,
  borderRadius: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--rl-gray-700)",
};

// Celda de grilla de calendario / meses: mismo lenguaje visual en ambos pickers.
function gridCellStyle({ selected, current, disabled, square }) {
  return {
    all: "unset",
    cursor: disabled ? "not-allowed" : "pointer",
    boxSizing: "border-box",
    width: "100%",
    ...(square ? { aspectRatio: "1 / 1" } : { height: 40 }),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    border: current && !selected ? "1.5px solid var(--rl-primary-300, #7CB3D6)" : "1.5px solid transparent",
    background: selected ? "var(--rl-primary-100, #D4E7F4)" : "transparent",
    color: disabled
      ? "var(--rl-gray-300)"
      : selected || current
        ? "var(--rl-primary-900)"
        : "var(--rl-gray-800)",
    font: (selected ? 700 : 500) + " 13px/1 var(--rl-font-body)",
    transition: "background 90ms",
  };
}

function PickerTrigger({ error, empty, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"prt-input" + (error ? " error" : "")}
      style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer" }}
    >
      <Icon name="calendar_today" size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          color: empty ? "var(--rl-gray-400)" : "var(--rl-gray-900)",
          font: (empty ? "400" : "500") + " 14px/1 var(--rl-font-body)",
        }}
      >
        {label}
      </span>
      <Icon name="expand_more" size={16} style={{ opacity: 0.55, flexShrink: 0 }} />
    </button>
  );
}

function PickerFooter({ onClear, onNow, nowLabel, nowDisabled }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 12,
        paddingTop: 10,
        borderTop: "1px solid var(--rl-gray-100)",
      }}
    >
      <Btn size="sm" kind="ghost" onClick={onClear}>Borrar</Btn>
      <Btn size="sm" kind="ghost" disabled={nowDisabled} onClick={onNow}>{nowLabel}</Btn>
    </div>
  );
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

/** Calendario en popover. `value`, `min` y `max` en ISO YYYY-MM-DD. */
export function DatePicker({ value, onChange, max, min, error, placeholder }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  // Se calcula en el cliente: en el servidor "hoy" sería otro día u otra zona.
  const [today, setToday] = useState("");
  useEffect(() => setToday(todayISO()), []);

  const anchor = value && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
  const [viewMonth, setViewMonth] = useState(anchor);
  useEffect(() => {
    if (open) setViewMonth(anchor || (today || todayISO()).slice(0, 7));
  }, [open, anchor, today]);

  useDismiss(open, rootRef, () => setOpen(false), [value]);

  const month = viewMonth || (today || "2000-01").slice(0, 7);
  const [vy, vm] = month.split("-").map(Number);
  const firstOfMonth = new Date(vy, vm - 1, 1);
  const offset = (firstOfMonth.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(vy, vm, 0).getDate();
  const cells = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = firstOfMonth.toLocaleString("es-CL", { month: "long", year: "numeric" });
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  const navMonth = (dir) => {
    let ny = vy;
    let nm = vm + dir;
    if (nm < 1) { nm = 12; ny -= 1; }
    if (nm > 12) { nm = 1; ny += 1; }
    setViewMonth(`${ny}-${String(nm).padStart(2, "0")}`);
  };

  const outOfRange = (iso) => (max && iso > max) || (min && iso < min);

  const pickDay = (d) => {
    const iso = `${vy}-${String(vm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (outOfRange(iso)) return;
    onChange && onChange(iso);
    setOpen(false);
  };

  const displayValue = (iso) => {
    if (!iso) return placeholder || "dd/mm/aaaa";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <PickerTrigger
        error={error}
        empty={!value}
        label={displayValue(value)}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div style={{ ...POPOVER, width: 304 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button type="button" onClick={() => navMonth(-1)} className="rc-nav-btn" style={NAV_BTN} aria-label="Mes anterior">
              <Icon name="chevron_left" size={18} />
            </button>
            <div style={{ font: "600 14px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>{monthLabel}</div>
            <button type="button" onClick={() => navMonth(1)} className="rc-nav-btn" style={NAV_BTN} aria-label="Mes siguiente">
              <Icon name="chevron_right" size={18} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w, i) => (
              <div
                key={i}
                style={{
                  font: "600 11px/1 var(--rl-font-ui)",
                  color: "var(--rl-gray-500)",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  textAlign: "center",
                  padding: "6px 0",
                }}
              >
                {w}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              if (d == null) return <div key={i} />;
              const iso = `${vy}-${String(vm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const disabled = outOfRange(iso);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickDay(d)}
                  aria-pressed={iso === value}
                  className="rc-grid-cell"
                  style={gridCellStyle({
                    selected: iso === value,
                    current: iso === today,
                    disabled,
                    square: true,
                  })}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <PickerFooter
            onClear={() => { onChange && onChange(""); setOpen(false); }}
            onNow={() => { onChange && onChange(today); setOpen(false); }}
            nowLabel="Hoy"
            nowDisabled={!today || outOfRange(today)}
          />
        </div>
      )}
    </div>
  );
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Selector de mes en popover. `value`, `min` y `max` en formato YYYY-MM. */
export function MonthPicker({ value, onChange, max, min, error, placeholder }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const [curMonth, setCurMonth] = useState("");
  useEffect(() => setCurMonth(currentMonthISO()), []);

  const anchorYear = value && /^\d{4}-\d{2}$/.test(value) ? +value.slice(0, 4) : null;
  const [viewYear, setViewYear] = useState(anchorYear);
  useEffect(() => {
    if (open) setViewYear(anchorYear || +(curMonth || currentMonthISO()).slice(0, 4));
  }, [open, anchorYear, curMonth]);

  useDismiss(open, rootRef, () => setOpen(false), [value]);

  const outOfRange = (mk) => (max && mk > max) || (min && mk < min);

  const pickMonth = (m) => {
    const mk = `${viewYear}-${String(m).padStart(2, "0")}`;
    if (outOfRange(mk)) return;
    onChange && onChange(mk);
    setOpen(false);
  };

  const displayValue = (mk) => {
    if (!mk || !/^\d{4}-\d{2}/.test(mk)) return placeholder || "Elige un mes…";
    const name = new Date(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1).toLocaleString("es-CL", {
      month: "long",
      year: "numeric",
    });
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <PickerTrigger
        error={error}
        empty={!value}
        label={displayValue(value)}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div style={{ ...POPOVER, width: 280 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button type="button" onClick={() => setViewYear((y) => y - 1)} className="rc-nav-btn" style={NAV_BTN} aria-label="Año anterior">
              <Icon name="chevron_left" size={18} />
            </button>
            <div style={{ font: "600 14px/1 var(--rl-font-display)", color: "var(--rl-gray-900)" }}>{viewYear}</div>
            <button type="button" onClick={() => setViewYear((y) => y + 1)} className="rc-nav-btn" style={NAV_BTN} aria-label="Año siguiente">
              <Icon name="chevron_right" size={18} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {MESES.map((name, i) => {
              const mk = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
              const disabled = outOfRange(mk);
              return (
                <button
                  key={mk}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickMonth(i + 1)}
                  aria-pressed={mk === value}
                  className="rc-grid-cell"
                  style={gridCellStyle({ selected: mk === value, current: mk === curMonth, disabled })}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <PickerFooter
            onClear={() => { onChange && onChange(""); setOpen(false); }}
            onNow={() => { onChange && onChange(curMonth); setOpen(false); }}
            nowLabel="Mes actual"
            nowDisabled={!curMonth || outOfRange(curMonth)}
          />
        </div>
      )}
    </div>
  );
}

const SEARCH_THRESHOLD = 10;

/**
 * Único dropdown del proyecto. `options` admite strings o
 * { value, label, icon?, iconBg?, iconColor?, disabled? }. Con 10 opciones o
 * más aparece buscador. El menú va en portal con position fixed para que no lo
 * recorte un contenedor con overflow hidden (ej. .prt-card.flush).
 */
export function Select({
  value, onChange, options, placeholder, error, disabled,
  size, style, className, autoFocus, onBlur, onClose, ref,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const pickedRef = useRef(false);
  const [menuPos, setMenuPos] = useState(null);

  const opts = (options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const sel = opts.find((o) => o.value === value) || null;
  const showSearch = opts.length >= SEARCH_THRESHOLD;
  const filtered = query
    ? opts.filter((o) => String(o.label || "").toLowerCase().includes(query.toLowerCase()))
    : opts;

  // Con autoFocus el menú se abre al montar: es el caso de la edición inline en
  // tablas, donde el control aparece ya en modo edición.
  useEffect(() => {
    if (!autoFocus) return;
    setOpen(true);
    const id = setTimeout(() => {
      (searchRef.current || triggerRef.current)?.focus();
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cerrar sin elegir se avisa con onClose, para que el llamador pueda
  // cancelar la edición en curso.
  useEffect(() => {
    if (!open) return;
    pickedRef.current = false;
    const onDoc = (e) => {
      const inRoot = rootRef.current && rootRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inRoot && !inMenu) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      setQuery("");
      if (!pickedRef.current && onClose) onClose();
      if (onBlur) onBlur();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const menuH = menuRef.current ? menuRef.current.offsetHeight : 320;
      const below = window.innerHeight - r.bottom - 12;
      const flip = below < Math.min(menuH, 320) && r.top > below;
      setMenuPos({
        left: r.left,
        width: r.width,
        top: flip ? undefined : r.bottom + 6,
        bottom: flip ? window.innerHeight - r.top + 6 : undefined,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const pick = (v) => {
    pickedRef.current = true;
    onChange && onChange(v);
    setOpen(false);
  };

  const iconBox = (o, px) => (
    <span
      style={{
        width: px,
        height: px,
        borderRadius: px > 22 ? 7 : 6,
        flexShrink: 0,
        background: o.iconBg || "var(--rl-gray-100)",
        color: o.iconColor || "var(--rl-gray-700)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={o.icon} size={px > 22 ? 15 : 13} />
    </span>
  );

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      style={{ position: "relative", ...(style || {}) }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={
          "prt-select" +
          (size === "sm" ? " prt-select-sm" : "") +
          (error ? " error" : "") +
          (className ? " " + className : "")
        }
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {sel ? (
          <>
            {sel.icon && iconBox(sel, size === "sm" ? 22 : 26)}
            <span
              style={{
                flex: 1,
                color: "var(--rl-gray-900)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sel.label}
            </span>
          </>
        ) : (
          <span
            style={{
              flex: 1,
              color: "var(--rl-gray-400)",
              font: (size === "sm" ? "400 12px/1 " : "400 14px/1 ") + "var(--rl-font-body)",
            }}
          >
            {placeholder || "Seleccionar…"}
          </span>
        )}
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: "fixed",
              top: menuPos.top,
              bottom: menuPos.bottom,
              left: menuPos.left,
              minWidth: menuPos.width,
              zIndex: 1000,
              background: "#fff",
              border: "1px solid var(--rl-gray-200)",
              borderRadius: 10,
              boxShadow: "0 12px 28px rgba(16,24,40,0.10)",
              padding: 6,
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {showSearch && (
              <div
                style={{
                  position: "sticky",
                  top: -6,
                  background: "#fff",
                  paddingBottom: 6,
                  marginBottom: 4,
                  zIndex: 1,
                }}
              >
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
                  placeholder="Buscar…"
                  className="prt-input"
                  style={{ height: 34, fontSize: 13 }}
                />
              </div>
            )}
            {filtered.length === 0 && (
              <div
                style={{
                  padding: "10px 12px",
                  font: "500 13px/1 var(--rl-font-body)",
                  color: "var(--rl-gray-500)",
                }}
              >
                Sin resultados.
              </div>
            )}
            {filtered.map((o) => {
              const isSel = o.value === value;
              return (
                <button
                  type="button"
                  key={String(o.value)}
                  role="option"
                  aria-selected={isSel}
                  className="rc-option"
                  disabled={!!o.disabled}
                  onClick={() => pick(o.value)}
                  style={{
                    all: "unset",
                    cursor: o.disabled ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "9px 10px",
                    marginBottom: 2,
                    borderRadius: 8,
                    background: isSel ? "var(--rl-primary-50)" : "transparent",
                    color: o.disabled
                      ? "var(--rl-gray-400)"
                      : isSel
                        ? "var(--rl-primary-900)"
                        : "var(--rl-gray-800)",
                    font: (isSel ? 600 : 500) + " 13.5px/1 var(--rl-font-body)",
                    opacity: o.disabled ? 0.5 : 1,
                    transition: "background 90ms",
                  }}
                >
                  {o.icon && iconBox(o, 26)}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.label}
                  </span>
                  {isSel && <Icon name="check" size={16} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
