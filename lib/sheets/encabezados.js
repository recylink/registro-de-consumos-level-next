import "server-only";

// Verificación del encabezado de una hoja contra el que la app espera.
//
// EL PROBLEMA
//
// El esquema es posicional, no nominal: los parsers leen `row[3]`, `row[4]`. Mover
// una columna en la planilla no rompe nada visible — la app sigue leyendo la misma
// posición y encuentra otro dato. Los costos pasan a leerse como consumos, las
// fechas como números. Nadie se entera hasta que alguien audita los totales.
//
// POR QUÉ NO SE RESUELVE RESOLVIENDO LAS COLUMNAS POR NOMBRE
//
// Sería lo obvio: leer el encabezado y armar nombre → índice. Pero el encabezado lo
// escriben personas, y ya hay evidencia de que lo tocan: "Subcategoria" sin tilde
// está documentado como caso real. Con resolución dinámica, renombrar una columna
// dejaría de encontrarla y el dato se leería como vacío — un modo de falla NUEVO,
// causado por una edición cosmética que hoy es inofensiva.
//
// Así que la posición sigue mandando, y lo que se agrega es la detección. La
// distinción que importa:
//
//   REORDENADA  una etiqueta conocida aparece en otra posición → los datos SÍ se van
//               a leer mal → se lanza. Cubre también las columnas borradas, porque
//               borrar una corre a todas las de su derecha.
//
//   RENOMBRADA  una etiqueta no coincide con ninguna esperada, pero las demás están
//               en su lugar → los datos se leen bien → aviso en el log, nada más.
//
// Lo que NO se toca: las columnas que alguien haya agregado a la DERECHA del
// encabezado esperado. Son suyas y la app las ignora.

/**
 * Normaliza una etiqueta para comparar: sin acentos, sin mayúsculas, sin espacios
 * de sobra. Es lo que hace que "Subcategoria" y "Subcategoría" sean la misma
 * columna, que es justamente el caso que se vio en producción.
 */
function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export class EncabezadoInesperadoError extends Error {
  constructor(hoja, movidas) {
    const detalle = movidas
      .map((m) => `"${m.etiqueta}" está en la columna ${m.encontradaEn} y se espera en la ${m.esperadaEn}`)
      .join("; ");
    super(
      `El encabezado de la hoja "${hoja}" no coincide con el que espera la app: ` +
        `${detalle}. No se leyeron los datos, porque leerlos por posición daría ` +
        `valores de otra columna. Restaurar el orden original del encabezado.`,
    );
    this.name = "EncabezadoInesperadoError";
    this.hoja = hoja;
    this.movidas = movidas;
  }
}

/**
 * Compara el encabezado real contra el esperado. Devuelve `{ movidas, faltantes }`.
 * No lanza: la decisión de cortar es de quien llama (ver `exigirEncabezado`).
 */
export function revisarEncabezado(real, esperado) {
  const posEsperada = new Map((esperado || []).map((h, i) => [norm(h), i]));
  const vistas = new Set();
  const movidas = [];

  (real || []).forEach((etiqueta, i) => {
    const k = norm(etiqueta);
    if (!k) return;
    const esperadaEn = posEsperada.get(k);
    // Etiqueta que la app no conoce: una columna agregada, o una renombrada. En
    // ninguno de los dos casos se puede concluir que haya un reordenamiento.
    if (esperadaEn == null) return;
    vistas.add(k);
    if (esperadaEn !== i) {
      movidas.push({ etiqueta: String(etiqueta).trim(), encontradaEn: i + 1, esperadaEn: esperadaEn + 1 });
    }
  });

  const faltantes = (esperado || []).filter((h) => norm(h) && !vistas.has(norm(h)));
  return { movidas, faltantes };
}

/**
 * Corta la lectura si el encabezado está reordenado; avisa si solo está renombrado.
 *
 * Un encabezado vacío (hoja recién creada, o sin la fila 1) no se considera un
 * problema: no hay nada que contradiga, y las hojas que la app crea ya vienen con
 * su encabezado.
 */
export function exigirEncabezado(hoja, real, esperado, { opcionales = [] } = {}) {
  if (!real || !real.length) return;
  const { movidas, faltantes: todas } = revisarEncabezado(real, esperado);
  if (movidas.length) throw new EncabezadoInesperadoError(hoja, movidas);

  // `opcionales` son columnas que legítimamente pueden no estar todavía. Hoy la
  // única es "ID": la agrega /api/migracion/columna-id, y hasta que corra su
  // ausencia es el estado normal, no un encabezado alterado.
  const opt = new Set(opcionales.map(norm));
  const faltantes = todas.filter((f) => !opt.has(norm(f)));
  if (faltantes.length) {
    // Renombrar no rompe la lectura, pero sí rompe la próxima migración que busque
    // la columna por su nombre, así que conviene que quede registrado.
    console.warn(
      `[rc:encabezado] "${hoja}": la app no encontró ${faltantes.map((f) => `"${f}"`).join(", ")}. ` +
        `Las columnas se siguen leyendo por posición, así que los datos están bien, ` +
        `pero alguien renombró el encabezado.`,
    );
  }
}
