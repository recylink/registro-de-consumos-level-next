import { NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/apps-script";
import { SDK_POST } from "@/lib/google/actions";
import { SHEETS } from "@/lib/instance";
import {
  borrarHoja,
  contadorLlamadas,
  invalidarHojas,
  leerHoja,
  reiniciarContador,
} from "@/lib/google/sheets-api";

// Verifica las reescrituras del bloque C.
//
//   curl -s -X POST http://localhost:3000/api/migracion/probe-c
//
// El bloque B se pudo probar en hojas descartables porque `append` y `update`
// reciben el nombre de la hoja. Acá no: las seis actions tienen su hoja fija, así
// que al Apps Script no se lo puede apuntar a otro lado.
//
// La salida es usar `setEmissions`, cuya hoja "Emisiones" NO existe en esta
// planilla: los dos backends la crean de cero, se corre la misma secuencia con
// cada uno por turnos, y se borra la hoja al terminar para dejar la planilla como
// estaba. No se toca ninguna hoja con datos.
//
// La secuencia incluye el caso que motivó el rediseño: ENCOGER. El Apps Script
// hacía clear() y reescribía; el SDK escribe y después recorta. Si el recorte no
// coincide, quedan filas viejas colgando y una lectura devuelve basura.
//
// Solo en desarrollo.

export const dynamic = "force-dynamic";

const HOJA = SHEETS.EMISIONES;

function fila(n, etiqueta) {
  return [
    "factor-empresa",
    `suc-${n}`,
    `clave-${n}`,
    n * 10,
    n % 2 === 0 ? "TRUE" : "",
    etiqueta,
    "2026-08",
  ];
}

// Cada paso es un `rows` distinto. Dos razones por las que el orden importa:
//
// 1. Crecer, encoger, vaciar y volver a crecer es donde aparecen las diferencias
//    de recorte, que es lo que este bloque cambió.
// 2. El estado es ACUMULATIVO: cada paso se compara sobre la hoja que dejó el
//    anterior. Así que los pasos con `divergenciaEsperada` van al final — desde el
//    primero que divergo a propósito, las dos hojas quedan legítimamente
//    distintas y todo lo que venga después heredaría esa diferencia. Se marcan
//    igual como `estadoContaminado` por si alguien agrega un paso abajo.
const SECUENCIA = [
  { nombre: "crear con 4 filas", rows: [fila(1, "a"), fila(2, "b"), fila(3, "c"), fila(4, "d")] },
  { nombre: "ENCOGER a 2 filas", rows: [fila(1, "a"), fila(2, "b")] },
  { nombre: "vaciar (0 filas)", rows: [] },
  { nombre: "volver a crecer a 3", rows: [fila(5, "e"), fila(6, "f"), fila(7, "g")] },
  // --- desde acá, divergencias declaradas: van últimas a propósito ---
  {
    nombre: "fila mas ancha: los dos rechazan, pero el Apps Script pierde la hoja",
    rows: [[...fila(8, "h"), "columna", "de", "mas"]],
    // Los dos backends rechazan la escritura, y sin embargo el estado final es
    // distinto — es LA razón por la que este bloque invirtió el orden:
    //
    //   Apps Script: clear() y después setValues(), que lanza. La hoja queda con
    //     el encabezado solo: se perdieron las filas que había. No es hipotético,
    //     pasa en esta prueba.
    //   SDK: valida y falla ANTES de escribir, así que la hoja queda intacta.
    //
    // Ver reemplazarHoja en lib/google/sheets-api.js.
    divergenciaEsperada:
      "los dos rechazan la fila; el Apps Script deja la hoja vacía y el SDK la deja intacta",
  },
  {
    nombre: "fila corta (se rellena al ancho del encabezado)",
    rows: [["factor-sucursal", "suc-9"]],
    // Divergencia deliberada, no una regresión: el Apps Script falla el guardado
    // entero ("El número de columnas de los datos no coincide...") y el SDK
    // rellena y escribe. Ver normalizarAncho en lib/google/sheets-api.js.
    divergenciaEsperada: "el Apps Script rechaza la fila corta; el SDK la rellena",
  },
];

async function correrSecuencia(enviar) {
  const estados = [];
  for (const paso of SECUENCIA) {
    let respuesta;
    let error = null;
    try {
      respuesta = await enviar({ action: "setEmissions", rows: paso.rows });
    } catch (err) {
      error = err.message || String(err);
    }
    invalidarHojas();
    estados.push({
      paso: paso.nombre,
      respuesta: respuesta ?? null,
      error,
      display: await leerHoja(HOJA, { crudo: false }),
      crudo: await leerHoja(HOJA, { crudo: true }),
    });
  }
  return estados;
}

function compararGrillas(a, b) {
  const difs = [];
  const filas = Math.max(a.length, b.length);
  if (a.length !== b.length) {
    difs.push({ ruta: "cantidad de filas", appsScript: a.length, sdk: b.length });
  }
  for (let i = 0; i < filas; i++) {
    const fa = a[i] || [];
    const fb = b[i] || [];
    for (let k = 0; k < Math.max(fa.length, fb.length); k++) {
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

  // Si la hoja existiera con datos, esta prueba los destruiría. Se niega a correr.
  invalidarHojas();
  const previo = await leerHoja(HOJA, { crudo: false });
  if (previo.length > 1) {
    return NextResponse.json(
      {
        error:
          `la hoja "${HOJA}" tiene ${previo.length} filas: la prueba la reescribe ` +
          `y no va a tocar datos existentes`,
        filas: previo.length,
      },
      { status: 409 },
    );
  }

  try {
    await borrarHoja(HOJA);
    const conAppsScript = await correrSecuencia(appsScriptPost);

    await borrarHoja(HOJA);
    reiniciarContador();
    const conSdk = await correrSecuencia((body) => SDK_POST[body.action](body));
    const llamadas = contadorLlamadas();

    // Índice del primer paso que diverge a propósito: desde el siguiente, el
    // estado de las dos hojas ya no es comparable.
    const primeraDivergencia = SECUENCIA.findIndex((s) => s.divergenciaEsperada);

    const pasos = SECUENCIA.map((s, i) => {
      const as = conAppsScript[i];
      const sdk = conSdk[i];
      const contaminado = primeraDivergencia !== -1 && i > primeraDivergencia;
      const difDisplay = compararGrillas(as.display, sdk.display);
      const difCrudo = compararGrillas(as.crudo, sdk.crudo);
      return {
        estadoContaminado: contaminado || undefined,
        paso: s.nombre,
        filasEsperadas: s.rows.length,
        filasResultantes: { appsScript: as.display.length, sdk: sdk.display.length },
        mismaRespuesta:
          JSON.stringify(as.respuesta ?? as.error) === JSON.stringify(sdk.respuesta ?? sdk.error),
        errorAppsScript: as.error,
        errorSdk: sdk.error,
        divergenciaEsperada: s.divergenciaEsperada || null,
        diferencias: [...difDisplay.map((d) => ({ ...d, modo: "display" })),
                      ...difCrudo.map((d) => ({ ...d, modo: "crudo" }))],
      };
    });

    // Una divergencia declarada de antemano no cuenta como regresión, pero se
    // reporta aparte: si un paso deja de divergir, el aviso también sirve.
    const conDif = pasos.filter(
      (p) => p.diferencias.length && !p.divergenciaEsperada && !p.estadoContaminado,
    );
    const divergenciasDeclaradas = pasos.filter((p) => p.divergenciaEsperada);
    const respDistintas = pasos.filter(
      (p) => !p.mismaRespuesta && !p.divergenciaEsperada && !p.estadoContaminado,
    );
    const escribioAlgo = pasos.some((p) => p.filasResultantes.sdk > 1);
    const declaradasQueYaNoDivergen = divergenciasDeclaradas.filter(
      (p) => !p.diferencias.length && p.mismaRespuesta,
    );

    return NextResponse.json({
      veredicto: !escribioAlgo
        ? "no se escribio nada: la prueba no verifica nada"
        : conDif.length === 0 && respDistintas.length === 0
          ? `las ${pasos.length - divergenciasDeclaradas.length} etapas comparables dejaron ` +
            `la hoja identica; ${divergenciasDeclaradas.length} divergencia(s) declarada(s)`
          : `hay diferencias no previstas en ${conDif.length} de ${pasos.length} etapas`,
      resumen: {
        etapas: pasos.length,
        etapasConDiferenciasNoPrevistas: conDif.length,
        divergenciasDeclaradas: divergenciasDeclaradas.length,
        respuestasDistintasNoPrevistas: respDistintas.length,
        escriturasSdk: llamadas.escrituras,
        // Si una divergencia declarada dejó de ocurrir, la nota quedó vieja.
        declaracionesObsoletas: declaradasQueYaNoDivergen.map((p) => p.paso),
      },
      pasos,
    });
  } finally {
    // La hoja no existía antes de la prueba: borrarla deja la planilla igual.
    try {
      await borrarHoja(HOJA);
    } catch (err) {
      console.error("[rc:probe-c] no se pudo borrar", HOJA, err);
    }
  }
}
