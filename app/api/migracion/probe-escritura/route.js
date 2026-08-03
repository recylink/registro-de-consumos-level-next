import { NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/apps-script";
import {
  agregarFilas,
  borrarHoja,
  crearHoja,
  invalidarHojas,
  leerHoja,
} from "@/lib/google/sheets-api";

// Mide cómo interpreta Google lo que escribe cada backend, en vez de suponerlo.
//
//   curl -s -X POST http://localhost:3000/api/migracion/probe-escritura
//
// El problema: `Range.setValues()` de Apps Script no dice si se comporta como
// `RAW` (guarda el string tal cual) o como `USER_ENTERED` (lo interpreta como si
// alguien lo tipeara). De eso depende que "31-07-26" quede texto o se convierta
// en fecha, y que "20.440" quede texto o se vuelva 20440. Los dos casos existen
// en las filas que escribe records.js, y elegir mal no lanza ningún error: solo
// cambia lo que leen parseDate y toNumber la próxima vez.
//
// El experimento escribe los MISMOS valores por los tres caminos en una hoja
// descartable, los lee de vuelta en los dos modos de lectura, y compara.
//
// Trabaja sobre una hoja propia con nombre reservado y la borra al terminar, así
// que no toca ninguna hoja de datos. Solo en desarrollo.

export const dynamic = "force-dynamic";

const HOJA = "ZZ Prueba Migracion";

// Valores elegidos por lo que aparece de verdad en las filas de la app, más los
// clásicos que Sheets reinterpreta.
const CASOS = [
  ["fecha DD-MM-YY (fmtDDMMYY)", "31-07-26"],
  ["numero con punto de miles", "20.440"],
  ["numero decimal con coma", "1234,5"],
  ["numero normal", 1234.5],
  ["texto que parece formula", "=1+1"],
  ["cero a la izquierda (N° cliente)", "0123"],
  ["texto con espacios", "  hola  "],
  ["vacio", ""],
  ["booleano como texto", "TRUE"],
  ["porcentaje", "15%"],
  ["monto con signo", "$15.000"],
];

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  const etiquetas = CASOS.map(([e]) => e);
  const valores = CASOS.map(([, v]) => v);
  const limpieza = [];

  try {
    // Hoja limpia: si quedó de una corrida anterior, se rehace.
    invalidarHojas();
    await borrarHoja(HOJA);
    await crearHoja(HOJA, etiquetas);

    // Fila 2: la escribe el Apps Script con setValues().
    await appsScriptPost({ action: "append", sheet: HOJA, values: [valores] });
    // Fila 3: el SDK con USER_ENTERED. Fila 4: el SDK con RAW.
    await agregarFilas(HOJA, [valores], { modo: "USER_ENTERED" });
    await agregarFilas(HOJA, [valores], { modo: "RAW" });

    const display = await leerHoja(HOJA, { crudo: false });
    const crudo = await leerHoja(HOJA, { crudo: true });

    const fila = (m, i) => (m[i] || []).map((v) => v);
    const as = { display: fila(display, 1), crudo: fila(crudo, 1) };
    const ue = { display: fila(display, 2), crudo: fila(crudo, 2) };
    const raw = { display: fila(display, 3), crudo: fila(crudo, 3) };

    const comparacion = CASOS.map(([etiqueta, entrada], i) => {
      const igualUE =
        as.display[i] === ue.display[i] && String(as.crudo[i]) === String(ue.crudo[i]);
      const igualRAW =
        as.display[i] === raw.display[i] && String(as.crudo[i]) === String(raw.crudo[i]);
      return {
        caso: etiqueta,
        entrada,
        appsScript: { display: as.display[i], crudo: as.crudo[i] },
        USER_ENTERED: { display: ue.display[i], crudo: ue.crudo[i] },
        RAW: { display: raw.display[i], crudo: raw.crudo[i] },
        coincideCon:
          igualUE && igualRAW ? "ambos" : igualUE ? "USER_ENTERED" : igualRAW ? "RAW" : "ninguno",
      };
    });

    const cuenta = (m) => comparacion.filter((c) => c.coincideCon === m).length;
    const soloUE = comparacion.filter((c) => c.coincideCon === "USER_ENTERED");
    const soloRAW = comparacion.filter((c) => c.coincideCon === "RAW");
    const ninguno = comparacion.filter((c) => c.coincideCon === "ninguno");

    return NextResponse.json({
      veredicto:
        ninguno.length > 0
          ? "hay casos que ningún modo reproduce — revisar a mano"
          : soloUE.length && soloRAW.length
            ? "los dos modos difieren según el caso — no hay equivalente único"
            : soloUE.length
              ? "setValues() se comporta como USER_ENTERED"
              : soloRAW.length
                ? "setValues() se comporta como RAW"
                : "todos los casos coinciden en ambos modos: la elección no cambia nada",
      resumen: {
        ambos: cuenta("ambos"),
        soloUSER_ENTERED: soloUE.length,
        soloRAW: soloRAW.length,
        ninguno: ninguno.length,
      },
      discriminantes: [...soloUE, ...soloRAW, ...ninguno].map((c) => c.caso),
      comparacion,
    });
  } finally {
    // La hoja se borra siempre, incluso si algo falló a mitad.
    try {
      await borrarHoja(HOJA);
      limpieza.push("hoja borrada");
    } catch (err) {
      limpieza.push("NO se pudo borrar la hoja: " + err.message);
      console.error("[rc:probe] limpieza", err);
    }
  }
}
