import { NextResponse } from "next/server";
import { apiPost, appsScriptPost } from "@/lib/apps-script";
import { SDK_POST } from "@/lib/google/actions";
import { usarSdk } from "@/lib/backend-flag";
import { borrarHoja, invalidarHojas, leerHoja } from "@/lib/google/sheets-api";

// Verifica las escrituras del bloque B (append / update / updateCells).
//
//   curl -s -X POST http://localhost:3000/api/migracion/probe-b
//
// Para lecturas alcanzaba con correr los dos backends y comparar la respuesta.
// Para escrituras no: correr los dos escribiría dos veces sobre lo mismo. Así que
// la prueba es equivalencia de EFECTO — la misma secuencia de operaciones sobre
// dos hojas descartables, una por backend, y después se compara cómo quedaron.
//
// Se compara el contenido final celda por celda, en los dos modos de lectura, y
// también los mensajes de error: `flows.js` y la UI los muestran textuales, así
// que un "sheet not found" que cambie de forma es una regresión visible.
//
// Ambas hojas se borran al terminar, pase lo que pase. Solo en desarrollo.

export const dynamic = "force-dynamic";

const HOJA_AS = "ZZ Prueba B AppsScript";
const HOJA_SDK = "ZZ Prueba B SDK";

/**
 * La secuencia. Cada paso se aplica igual a los dos backends, con su hoja.
 * Incluye los casos que el código original trataba de forma particular: append
 * vacío (no-op), celda sin columna (se ignora), y varias celdas de una vez.
 */
function pasos(hoja) {
  return [
    {
      nombre: "append 2 filas (crea la hoja)",
      body: {
        action: "append",
        sheet: hoja,
        values: [
          ["a1", "b1", 10, "31-07-26"],
          ["a2", "b2", 20, "01-08-26"],
        ],
      },
    },
    {
      nombre: "append 1 fila mas",
      body: { action: "append", sheet: hoja, values: [["a3", "b3", 30, "02-08-26"]] },
    },
    {
      nombre: "append vacio (no-op)",
      body: { action: "append", sheet: hoja, values: [] },
    },
    {
      nombre: "update una celda",
      body: { action: "update", sheet: hoja, row: 2, col: 3, value: 999 },
    },
    {
      nombre: "updateCells 3 celdas, una sin col (se ignora)",
      body: {
        action: "updateCells",
        sheet: hoja,
        cells: [
          { row: 1, col: 1, value: "editado" },
          { row: 3, col: 2, value: "tambien" },
          { row: 4, value: "sin columna" },
        ],
      },
    },
  ];
}

/** Errores que deben salir iguales por los dos backends. */
function casosError(hoja) {
  return [
    { nombre: "append sin sheet", body: { action: "append", values: [["x"]] } },
    { nombre: "update sin row/col", body: { action: "update", sheet: hoja, value: 1 } },
    {
      nombre: "update en hoja inexistente",
      body: { action: "update", sheet: "ZZ No Existe Nunca", row: 1, col: 1, value: 1 },
    },
    {
      nombre: "updateCells en hoja inexistente",
      body: {
        action: "updateCells",
        sheet: "ZZ No Existe Nunca",
        cells: [{ row: 1, col: 1, value: 1 }],
      },
    },
  ];
}

const viaAppsScript = (body) => appsScriptPost(body);
const viaSdk = (body) => SDK_POST[body.action](body);

async function capturar(fn, body) {
  try {
    return { ok: true, respuesta: await fn(body) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function compararGrillas(a, b) {
  const difs = [];
  const filas = Math.max(a.length, b.length);
  if (a.length !== b.length) {
    difs.push({ ruta: "filas", appsScript: a.length, sdk: b.length });
  }
  for (let i = 0; i < filas; i++) {
    const fa = a[i] || [];
    const fb = b[i] || [];
    const cols = Math.max(fa.length, fb.length);
    for (let k = 0; k < cols; k++) {
      if (String(fa[k] ?? "") !== String(fb[k] ?? "")) {
        difs.push({
          ruta: `fila ${i + 1}, col ${k + 1}`,
          appsScript: fa[k] ?? null,
          sdk: fb[k] ?? null,
        });
      }
    }
  }
  return difs;
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  try {
    invalidarHojas();
    await borrarHoja(HOJA_AS);
    await borrarHoja(HOJA_SDK);

    // Secuencia de escritura, paso a paso, en las dos hojas.
    const operaciones = [];
    const pasosAs = pasos(HOJA_AS);
    const pasosSdk = pasos(HOJA_SDK);
    for (let i = 0; i < pasosAs.length; i++) {
      const as = await capturar(viaAppsScript, pasosAs[i].body);
      const sdk = await capturar(viaSdk, pasosSdk[i].body);
      operaciones.push({
        paso: pasosAs[i].nombre,
        appsScript: as,
        sdk,
        // Las respuestas traen contadores (`appended`, `updated`) que los
        // consumidores no leen hoy, pero un cambio de forma delataría un
        // malentendido sobre qué hacía el original.
        mismaRespuesta:
          JSON.stringify(as.respuesta ?? as.error) === JSON.stringify(sdk.respuesta ?? sdk.error),
      });
    }

    // Cómo quedaron las dos hojas.
    invalidarHojas();
    const [asDisplay, sdkDisplay, asCrudo, sdkCrudo] = await Promise.all([
      leerHoja(HOJA_AS, { crudo: false }),
      leerHoja(HOJA_SDK, { crudo: false }),
      leerHoja(HOJA_AS, { crudo: true }),
      leerHoja(HOJA_SDK, { crudo: true }),
    ]);

    const difDisplay = compararGrillas(asDisplay, sdkDisplay);
    const difCrudo = compararGrillas(asCrudo, sdkCrudo);
    const celdas = asDisplay.reduce((n, f) => n + f.filter((v) => v !== "").length, 0);

    // Paridad de errores.
    const errores = [];
    const casosAs = casosError(HOJA_AS);
    const casosSdk = casosError(HOJA_SDK);
    for (let i = 0; i < casosAs.length; i++) {
      const as = await capturar(viaAppsScript, casosAs[i].body);
      const sdk = await capturar(viaSdk, casosSdk[i].body);
      errores.push({
        caso: casosAs[i].nombre,
        appsScript: as.ok ? "no fallo: " + JSON.stringify(as.respuesta) : as.error,
        sdk: sdk.ok ? "no fallo: " + JSON.stringify(sdk.respuesta) : sdk.error,
        // El mensaje del Apps Script para hoja inexistente lleva el nombre de SU
        // hoja, así que se comparan quitando los nombres de hoja de la prueba.
        igual:
          (as.ok ? "ok" : as.error.replace(HOJA_AS, "«hoja»")) ===
          (sdk.ok ? "ok" : sdk.error.replace(HOJA_SDK, "«hoja»")),
      });
    }

    // Fase router: las fases anteriores llaman a SDK_POST directo, así que
    // verifican la traducción pero no el enrutamiento. Esto escribe pasando por
    // `apiPost`, que es lo que llaman de verdad lib/sheets/ y los Server Actions,
    // y deja constancia de a qué backend lo manda el flag.
    const HOJA_ROUTER = "ZZ Prueba B Router";
    let router;
    try {
      await borrarHoja(HOJA_ROUTER);
      const porSdk = ["append", "update", "updateCells"].map((a) => ({
        action: a,
        // usarSdk lanza si el flag la pide sin credenciales: eso también es un
        // resultado que vale reportar.
        destino: (() => {
          try {
            return usarSdk(a) ? "sdk" : "appsScript";
          } catch (err) {
            return "ERROR: " + err.message;
          }
        })(),
      }));
      await apiPost({ action: "append", sheet: HOJA_ROUTER, values: [["router", 1]] });
      await apiPost({ action: "update", sheet: HOJA_ROUTER, row: 1, col: 2, value: 42 });
      invalidarHojas();
      const grilla = await leerHoja(HOJA_ROUTER, { crudo: false });
      router = {
        destinoSegunFlag: porSdk,
        escrito: grilla,
        ok: grilla.length === 1 && grilla[0][0] === "router" && String(grilla[0][1]) === "42",
      };
    } catch (err) {
      router = { ok: false, error: err.message };
    } finally {
      try {
        await borrarHoja(HOJA_ROUTER);
      } catch {
        /* se reporta abajo si quedó */
      }
    }

    const respuestasDistintas = operaciones.filter((o) => !o.mismaRespuesta);
    const erroresDistintos = errores.filter((e) => !e.igual);
    const todoIgual =
      !difDisplay.length &&
      !difCrudo.length &&
      !erroresDistintos.length &&
      celdas > 0 &&
      router.ok;

    return NextResponse.json({
      veredicto: todoIgual
        ? `las dos hojas quedaron identicas (${celdas} celdas escritas), los errores coinciden y el router escribe`
        : celdas === 0
          ? "no se escribio nada: la prueba no verifica nada"
          : !router.ok
            ? "el contenido coincide pero el router falló"
            : "hay diferencias",
      resumen: {
        celdasEscritas: celdas,
        diferenciasContenidoDisplay: difDisplay.length,
        diferenciasContenidoCrudo: difCrudo.length,
        respuestasDistintas: respuestasDistintas.length,
        erroresDistintos: erroresDistintos.length,
        routerOk: router.ok,
      },
      diferenciasContenido: { display: difDisplay, crudo: difCrudo },
      router,
      operaciones,
      errores,
    });
  } finally {
    for (const h of [HOJA_AS, HOJA_SDK]) {
      try {
        await borrarHoja(h);
      } catch (err) {
        console.error("[rc:probe-b] no se pudo borrar", h, err);
      }
    }
  }
}
