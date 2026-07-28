// Detección de consumos atípicos: ±40% contra el promedio histórico de la misma
// sucursal, tipo y subcategoría. Portado de proto/manual.jsx.
//
// Con menos de 3 registros no se opina: dos datos no hacen un promedio útil y
// avisar de "valor atípico" en el tercer registro de la vida solo genera ruido.

const MIN_MUESTRA = 3;
const UMBRAL_PCT = 40;

export function detectAnomaly(records, sucursal, { type, subcat, cantidad }) {
  if (!sucursal || !type || !cantidad) return null;
  const similares = (records || []).filter(
    (r) =>
      r.estado !== "eliminada" &&
      r.sucursal === sucursal &&
      r.type === type &&
      (subcat ? r.subcat === subcat : true),
  );
  if (similares.length < MIN_MUESTRA) return null;

  const promedio = similares.reduce((a, r) => a + r.cantidad, 0) / similares.length;
  if (!promedio) return null;

  const actual = parseFloat(cantidad);
  const pct = ((actual - promedio) / promedio) * 100;
  if (Math.abs(pct) < UMBRAL_PCT) return null;

  return { pct: Math.round(pct), avg: Math.round(promedio), direction: pct > 0 ? "up" : "down" };
}
