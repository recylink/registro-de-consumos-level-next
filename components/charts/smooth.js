/**
 * Catmull-Rom convertido a Bézier cúbica, para curvas suaves entre puntos.
 *
 * Tensión 0.2: suaviza sin overshoot. Importa en series de consumo, porque una
 * curva que se pasa de los puntos dibuja valores que nunca se registraron.
 *
 * En el prototipo esta función vivía en dashboard.jsx y el gráfico de impacto la
 * usaba mediante `typeof smoothPath === "function"`, con un fallback a línea
 * recta por si el otro script no había cargado. Con módulos el import lo
 * garantiza.
 */
export function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const t = 0.2;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
