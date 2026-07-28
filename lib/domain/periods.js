// Períodos y ventanas de meses.
//
// Diferencia importante con el prototipo: allá la ventana de 12 meses era una
// constante de módulo calculada con `new Date()` al cargar el script. Acá el mes
// actual entra como parámetro (`anchor`), porque el mismo cálculo corre en el
// servidor y en el navegador: si cada lado leyera su propio reloj, el HTML del
// servidor y el del cliente podrían diferir y la hidratación fallaría (o peor,
// se rompería a medianoche o entre zonas horarias).
//
// El ancla la fija la página en el servidor con `currentMonthKey()` y viaja como
// prop hasta los componentes de cliente.

import { monthLabelShort } from "./format";

export const monthKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

/** Mes actual del servidor, en formato YYYY-MM. */
export function currentMonthKey(now = new Date()) {
  return monthKey(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Ventana de `count` meses que termina en `anchor` (incluido), en orden
 * cronológico.
 */
export function monthsWindow(anchor, count = 12) {
  const [y0, m0] = String(anchor).split("-").map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    let y = y0;
    let m = m0 - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    out.push(monthKey(y, m));
  }
  return out;
}

/** Mes anterior al ancla. */
export function prevMonthKey(anchor) {
  const w = monthsWindow(anchor, 2);
  return w[0];
}

/**
 * Meses entre `start` y `end`, inclusive. Tolera los argumentos invertidos y
 * corta a 240 meses para que un rango absurdo no cuelgue el render.
 */
export function monthKeysInRange(start, end) {
  if (!start || !end) return [];
  if (start > end) [start, end] = [end, start];
  const [ys, ms] = start.split("-").map(Number);
  const [ye, me] = end.split("-").map(Number);
  const out = [];
  let y = ys;
  let m = ms;
  let guard = 0;
  while ((y < ye || (y === ye && m <= me)) && guard++ < 240) {
    out.push(monthKey(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** "custom:YYYY-MM:YYYY-MM" → { start, end }, o null si no es un rango custom. */
export function parseCustomPeriod(period) {
  if (typeof period !== "string" || !period.startsWith("custom:")) return null;
  const [, start, end] = period.split(":");
  if (!start || !end) return null;
  return { start, end };
}

const SPANS = { "12m": 12, "6m": 6, "3m": 3, "1m": 1 };

/** Período de filtro → lista de meses, en orden cronológico. */
export function periodToMonthKeys(period, anchor) {
  const custom = parseCustomPeriod(period);
  if (custom) return monthKeysInRange(custom.start, custom.end);
  return monthsWindow(anchor, SPANS[period] ?? 12);
}

const LABELS = {
  "12m": "Últimos 12 meses",
  "6m": "Últimos 6 meses",
  "3m": "Últimos 3 meses",
};

export function periodLabel(period, anchor) {
  const custom = parseCustomPeriod(period);
  if (custom) return monthLabelShort(custom.start) + " — " + monthLabelShort(custom.end);
  if (period === "1m") {
    const [y, m] = String(anchor).split("-");
    const names = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `Mes actual (${names[parseInt(m, 10) - 1]} ${y})`;
  }
  return LABELS[period] || period;
}
