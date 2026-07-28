// Formateo para mostrar. Portado de proto/state.jsx. Todo en es-CL.

export function fmtCLP(n) {
  if (n == null || isNaN(n)) return "—";
  return "$" + Math.round(n).toLocaleString("es-CL");
}

export function fmtNum(n) {
  if (n == null || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("es-CL");
}

export function fmtTon(n, dec = 1) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("es-CL", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

/** ISO → "DD/MM/AA". */
export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-05" → "may 26". */
export function monthLabelShort(mk) {
  const [y, m] = String(mk).split("-");
  return MESES_CORTOS[parseInt(m, 10) - 1] + " " + y.slice(2);
}

/** "2026-05-15" o "2026-05" → "may 26". */
export function fmtMonth(iso) {
  if (!iso || String(iso).length < 7) return "—";
  return monthLabelShort(String(iso).slice(0, 7));
}

/**
 * Fecha-hora ISO → "DD/MM/AA HH:mm" en hora local. Si no parsea devuelve el
 * texto original: son valores que vienen del Sheet y es mejor mostrarlos crudos
 * que esconderlos.
 */
export function fmtDateTime(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).trim() || "—";
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
