// Conversión entre los valores que devuelve/espera Google Sheets y los del
// dominio. Portado desde proto/sync.jsx sin cambiar comportamiento: el Sheet ya
// tiene datos escritos con estas reglas, cualquier ajuste los reinterpreta.
//
// El Apps Script devuelve *display values*, o sea texto con formato local
// (miles con punto, decimales con coma, fechas DD/MM/YYYY). De ahí la
// tolerancia de estos parsers.

/** Cualquier formato de fecha visto en la planilla → ISO "YYYY-MM-DD". */
export function parseDate(s) {
  if (s == null || s === "") return "";
  const str = String(s).trim();
  let m;
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  // DD-MM-YY (año de 2 dígitos) — formato con el que escribimos los manuales.
  m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (m) return `20${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  // Serial de fecha de Sheets (días desde 1899-12-30). El rango acota a fechas
  // plausibles (1970–2119) para no tragarse un consumo suelto.
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = parseFloat(str);
    if (n > 25569 && n < 80000) {
      const d = new Date((n - 25569) * 86400000);
      return (
        d.getUTCFullYear() +
        "-" +
        String(d.getUTCMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getUTCDate()).padStart(2, "0")
      );
    }
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  return str;
}

/** Número con formato chileno ("$ 1.234,56") → Number. Vacío → 0. */
export function toNumber(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v)
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Columna "Tipo" de la hoja Combustible → id de subcategoría. */
export function combSubcatFromLabel(tipo) {
  const t = (tipo || "").toLowerCase();
  if (t.includes("petr")) return "diesel";
  if (t.includes("kerosene")) return "kerosene";
  if (t.includes("gas natural")) return "gas-natural";
  if (t.includes("gas") || t.includes("glp")) return "glp";
  return null;
}

/**
 * Columna "Subcategoría" de la hoja Agua → id de subcategoría.
 * Predefinidas: Potable/Gris/Industrial. Cualquier otra (ej "Riego") cae en
 * "otro:<slug>", que es la forma que espera getSubcatsFor().
 */
export function aguaSubcatFromLabel(label) {
  if (!label) return null;
  const t = String(label).trim();
  if (!t) return null;
  const tl = t.toLowerCase();
  if (tl === "potable") return "potable";
  if (tl === "gris") return "gris";
  if (tl === "industrial") return "industrial";
  return "otro:" + tl.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export function estadoLabel(estado) {
  return estado === "eliminada" ? "Eliminada" : "Activa";
}

export function estadoValue(label) {
  if (!label) return "activa";
  const t = String(label).trim().toLowerCase();
  return t === "eliminada" || t === "eliminado" ? "eliminada" : "activa";
}

export function origenLabel(origen) {
  const o = String(origen || "").toLowerCase();
  if (o === "manual") return "Manual";
  if (o === "documento" || o === "pdf") return "Documento";
  if (o === "foto") return "Foto";
  return ""; // "sheets" = fila preexistente, sin origen declarado
}

export function origenValue(label) {
  const t = String(label || "").trim().toLowerCase();
  if (t === "manual") return "manual";
  if (t === "documento" || t === "pdf") return "documento";
  if (t === "foto") return "foto";
  return "sheets";
}

/** ISO → "DD/MM/YYYY" del último día de ese mes. */
export function endOfMonth(iso) {
  if (!iso) return "";
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return String(last).padStart(2, "0") + "/" + String(m).padStart(2, "0") + "/" + y;
}

/**
 * ISO → "DD-MM-YY". Formato de los registros manuales: orden D-M-Y explícito
 * para que el Sheet no lo lea como M-D-Y.
 */
export function fmtDDMMYY(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return iso;
  return m[3] + "-" + m[2] + "-" + m[1].slice(2);
}

/** Período "YYYY-MM" → ISO del último día del mes. */
export function lastDayOfMonth(yyyymm) {
  if (!yyyymm || typeof yyyymm !== "string") return "";
  const parts = yyyymm.split("-").map(Number);
  if (parts.length < 2 || !parts[0] || !parts[1]) return "";
  const [y, m] = parts;
  const lastDay = new Date(y, m, 0).getDate();
  return y + "-" + String(m).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0");
}
