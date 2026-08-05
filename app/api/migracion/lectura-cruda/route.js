import { NextResponse } from "next/server";
import { HOJAS_REGISTROS } from "@/lib/instance";
import { ENCABEZADOS } from "@/lib/google/headers";
import { contadorLlamadas, leerHoja, reiniciarContador } from "@/lib/google/sheets-api";
import { parseDate, toNumber } from "@/lib/domain/parse";

// Informe: ¿se puede pasar la lectura de las hojas de consumo a valores crudos?
//
//   curl -s 'http://localhost:3000/api/migracion/lectura-cruda?filas=200'
//
// NO ESCRIBE NADA. Es una medición, y existe porque el cambio parece trivial y no lo es.
//
// EL CONTEXTO
//
// Hoy la app lee con FORMATTED_VALUE (el `getDisplayValues()` del Apps Script), que
// devuelve strings con formato local: "15.771,848" en vez de 15771.848, "31-07-26" en
// vez de un serial. De ahí vienen `toNumber`, que normaliza coma y miles, y los seis
// formatos de fecha que maneja `parseDate`.
//
// El SDK puede pedir UNFORMATTED_VALUE y devolver números y seriales de verdad, lo
// que dejaría casi todo eso sin razón de ser. Pero cambiar el modo de lectura cambia
// lo que ven los parsers, en columnas que contienen datos escritos por personas
// durante años. Las dos trampas concretas:
//
//   1. Una celda con texto en una columna numérica ("1.234 kWh", "s/i", "-") sigue
//      llegando como string en modo crudo. Así que `toNumber` no se puede borrar: se
//      convierte en el fallback, no en la regla.
//   2. Las fechas crudas llegan como serial (número de días desde 1899-12-30).
//      `parseDate` hoy no sabe leer eso, y un serial interpretado como año da fechas
//      absurdas en silencio.
//
// QUÉ MIDE
//
// Fila por fila y columna por columna, compara qué obtendría la app con cada modo:
//
//   coincide      los dos modos dan el mismo valor tras parsear. Migrable.
//   soloCrudo     el crudo mejora (número exacto donde el display daba texto).
//   soloDisplay   el crudo empeora o no se entiende → hay que manejar ese caso ANTES.
//
// El veredicto útil es `bloqueantes`: si viene vacío para las tres hojas, el cambio
// es seguro. Si no, cada entrada trae hoja, fila y valor para ir a mirarla.
//
// Se corre contra la planilla real, sin escribirla. La decisión de cambiar el modo
// queda para después de leer esto — igual que MODO_ESCRITURA salió de medirlo con
// /api/migracion/probe-escritura y no de suponerlo.

// SOLO EN DESARROLLO, como el resto de /api/migracion/. No escribe, pero devuelve
// contenido de celdas de la planilla en el cuerpo de la respuesta, y eso no tiene por
// qué estar disponible en el deploy.

export const dynamic = "force-dynamic";

// Columnas por hoja que la app lee como número o como fecha. Salen de LAYOUT
// (lib/sheets/records.js) y son las únicas donde el modo de lectura cambia algo:
// el resto son textos, iguales en los dos modos.
const NUMERICAS = {
  Combustible: { fechas: [2], numeros: [3, 4] },
  Electricidad: { fechas: [3], numeros: [4, 5] },
  Agua: { fechas: [3], numeros: [4, 5] },
};

/** Serial de Sheets → ISO. Epoch 1899-12-30, y los seriales pueden traer fracción. */
function serialAIso(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function compararNumero(display, crudo) {
  const conDisplay = toNumber(display);
  const esNumeroCrudo = typeof crudo === "number" && Number.isFinite(crudo);

  if (!esNumeroCrudo) {
    // El crudo también devolvió texto: la celda no es numérica en la planilla. Los
    // dos modos quedan igual, así que `toNumber` sigue siendo necesario pero el
    // cambio no rompe nada acá.
    const conCrudo = toNumber(crudo);
    return conDisplay === conCrudo
      ? { estado: "coincide" }
      : { estado: "soloDisplay", display, crudo, motivo: "texto que se parsea distinto en cada modo" };
  }

  if (conDisplay === crudo) return { estado: "coincide" };
  // Diferencias de redondeo del formato: "15.771,85" mostrado, 15771.848 real. El
  // crudo es el valor verdadero, así que esto es una mejora, no un problema.
  const rel = Math.abs(crudo - conDisplay) / (Math.abs(crudo) || 1);
  if (rel < 0.01) return { estado: "soloCrudo", display, crudo, motivo: "el display venía redondeado" };
  return { estado: "soloDisplay", display, crudo, motivo: "los dos modos dan números distintos" };
}

function compararFecha(display, crudo) {
  const conDisplay = parseDate(display);
  if (typeof crudo === "number") {
    const iso = serialAIso(crudo);
    if (!iso) return { estado: "soloDisplay", display, crudo, motivo: "serial ilegible" };
    return conDisplay === iso
      ? { estado: "coincide" }
      : { estado: "soloDisplay", display, crudo, iso, conDisplay, motivo: "el serial no da la misma fecha" };
  }
  // Fecha guardada como texto: el crudo la devuelve tal cual, así que `parseDate`
  // sigue haciendo falta igual. Sin cambio.
  return parseDate(crudo) === conDisplay
    ? { estado: "coincide" }
    : { estado: "soloDisplay", display, crudo, motivo: "texto de fecha que cada modo parsea distinto" };
}

export async function GET(req) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  const limite = Math.min(parseInt(new URL(req.url).searchParams.get("filas") || "300", 10), 2000);
  reiniciarContador();
  const hojas = [];

  for (const hoja of HOJAS_REGISTROS) {
    const cols = NUMERICAS[hoja];
    if (!cols) continue;

    const [display, crudo] = await Promise.all([
      leerHoja(hoja, { crudo: false }),
      leerHoja(hoja, { crudo: true }),
    ]);

    const conteo = { coincide: 0, soloCrudo: 0, soloDisplay: 0 };
    const bloqueantes = [];
    const mejoras = [];

    const filas = Math.min(display.length, crudo.length, limite + 1);
    for (let i = 1; i < filas; i++) {
      const fd = display[i] || [];
      const fc = crudo[i] || [];
      const revisar = (col, cmp) => {
        const d = fd[col - 1];
        const c = fc[col - 1];
        // Celda vacía en los dos modos: nada que comparar.
        if ((d === "" || d == null) && (c === "" || c == null)) return;
        const r = cmp(d, c);
        conteo[r.estado]++;
        const donde = { fila: i + 1, columna: col, encabezado: ENCABEZADOS[hoja]?.[col - 1] ?? "" };
        if (r.estado === "soloDisplay") bloqueantes.push({ ...donde, ...r });
        if (r.estado === "soloCrudo" && mejoras.length < 10) mejoras.push({ ...donde, ...r });
      };
      for (const col of cols.fechas) revisar(col, compararFecha);
      for (const col of cols.numeros) revisar(col, compararNumero);
    }

    hojas.push({
      hoja,
      filasRevisadas: Math.max(0, filas - 1),
      conteo,
      // Se recortan: con 100 celdas mal, las primeras 20 ya dicen qué patrón es.
      bloqueantes: bloqueantes.slice(0, 20),
      bloqueantesTotal: bloqueantes.length,
      mejoras,
      veredicto: bloqueantes.length ? "revisar antes de cambiar" : "migrable",
    });
  }

  const total = hojas.reduce((n, h) => n + h.bloqueantesTotal, 0);
  return NextResponse.json({
    modo: "informe",
    escribe: false,
    veredicto: total
      ? `${total} celdas se leerían distinto. Ver bloqueantes por hoja.`
      : "Ninguna celda cambia de significado: se puede pasar a crudo.",
    // Lo que hay que hacer sí o sí antes de cambiar el modo, gane o pierda el resto.
    pendienteDeCodigo: [
      "parseDate tiene que aceptar seriales de Sheets (hoy solo texto).",
      "toNumber se queda como fallback: en modo crudo una celda con texto sigue llegando como texto.",
    ],
    hojas,
    llamadas: contadorLlamadas(),
  });
}
