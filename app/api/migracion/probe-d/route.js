import { NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/apps-script";
import { SDK_POST } from "@/lib/google/actions";
import { SHEETS } from "@/lib/instance";
import { ENCABEZADOS_CONFIG_SUCURSALES } from "@/lib/google/headers";
import { invalidarHojas, leerHoja, reemplazarHoja } from "@/lib/google/sheets-api";

// Verifica el bloque D: upsertSucursal y deleteSucursal.
//
//   curl -s -X POST http://localhost:3000/api/migracion/probe-d
//
// A diferencia del bloque C, acá no hay escapatoria: las dos actions operan sobre
// "Config Sucursales", que TIENE datos reales. Así que se toma una copia de la
// hoja al empezar y se restaura al terminar, pase lo que pase.
//
// La copia se escribe también en el log del servidor antes de tocar nada. Si el
// proceso muere en el medio, el `finally` no corre y la única forma de recuperar
// las filas es de ahí.
//
// Se opera sobre un Sucursal ID inventado, y se comprueba aparte que las filas de
// las sucursales REALES no se muevan: el sentido de upsertSucursal es tocar solo
// las de una sucursal, y una regresión ahí no la mostraría comparar únicamente
// las filas nuevas.
//
// Solo en desarrollo.

export const dynamic = "force-dynamic";

const HOJA = SHEETS.CONFIG_SUCURSALES;
const ID = "ZZ-PRUEBA-D";

function fila(n) {
  return [
    ID,
    `Sucursal de prueba ${n}`,
    `Calle ${n}`,
    "TRUE",
    "electricidad",
    `subcat-${n}`,
    "SEN",
    "",
    "",
    "",
    "kWh",
    "Enel",
    "",
    `000${n}`,
  ];
}

const SECUENCIA = [
  { nombre: "upsert 2 filas (inserta)", body: { action: "upsertSucursal", id: ID, rows: [fila(1), fila(2)] } },
  { nombre: "upsert 3 filas (reemplaza y crece)", body: { action: "upsertSucursal", id: ID, rows: [fila(3), fila(4), fila(5)] } },
  { nombre: "upsert 1 fila (reemplaza y encoge)", body: { action: "upsertSucursal", id: ID, rows: [fila(6)] } },
  { nombre: "upsert 0 filas (equivale a borrar)", body: { action: "upsertSucursal", id: ID, rows: [] } },
  { nombre: "upsert 2 filas de nuevo", body: { action: "upsertSucursal", id: ID, rows: [fila(7), fila(8)] } },
  { nombre: "delete", body: { action: "deleteSucursal", id: ID } },
  { nombre: "delete otra vez (idempotente)", body: { action: "deleteSucursal", id: ID } },
];

const CASOS_ERROR = [
  { nombre: "upsert sin id", body: { action: "upsertSucursal", rows: [fila(1)] } },
  { nombre: "delete sin id", body: { action: "deleteSucursal" } },
];

const esDePrueba = (f) => String(f[0]) === ID;

/**
 * El /exec falla con "fetch failed" cada tantas llamadas, y encima puede fallar
 * DESPUÉS de haber escrito: en una corrida de esta prueba el request murió y las
 * filas estaban puestas igual. Sin reintento eso aparece como diferencia entre
 * backends cuando es una caída de red del viejo.
 *
 * Reintentar una ESCRITURA solo es admisible porque estas dos son idempotentes:
 * `upsertSucursal` reemplaza las filas de un id y `deleteSucursal` las borra, así
 * que repetirlas deja el mismo resultado. No copiar este reintento a un `append`.
 */
async function conReintentoIdempotente(fn, body, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn(body);
    } catch (err) {
      if (!/fetch failed|ECONN|socket|network/i.test(err.message || "")) throw err;
      ultimo = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw ultimo;
}

async function correrSecuencia(enviar) {
  const estados = [];
  for (const paso of SECUENCIA) {
    let respuesta = null;
    let error = null;
    try {
      respuesta = await enviar(paso.body);
    } catch (err) {
      error = err.message || String(err);
    }
    invalidarHojas();
    const grilla = await leerHoja(HOJA, { crudo: true });
    estados.push({
      paso: paso.nombre,
      respuesta,
      error,
      // Se separan: las de prueba se comparan entre backends, las reales tienen
      // que quedar intactas en los dos.
      dePrueba: grilla.slice(1).filter(esDePrueba),
      reales: grilla.slice(1).filter((f) => !esDePrueba(f) && f.some((c) => c !== "")),
    });
  }
  return estados;
}

function comparar(a, b) {
  const difs = [];
  if (a.length !== b.length) {
    difs.push({ ruta: "cantidad de filas", appsScript: a.length, sdk: b.length });
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const fa = a[i] || [];
    const fb = b[i] || [];
    for (let k = 0; k < Math.max(fa.length, fb.length); k++) {
      if (String(fa[k] ?? "") !== String(fb[k] ?? "")) {
        difs.push({ ruta: `fila ${i + 1}, col ${k + 1}`, appsScript: fa[k] ?? null, sdk: fb[k] ?? null });
      }
    }
  }
  return difs;
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  invalidarHojas();
  const copia = await leerHoja(HOJA, { crudo: true });
  const filasOriginales = copia.slice(1).filter((f) => f.some((c) => c !== ""));

  if (filasOriginales.some(esDePrueba)) {
    return NextResponse.json(
      { error: `ya hay filas con Sucursal ID "${ID}" de una corrida anterior: revisar la hoja a mano` },
      { status: 409 },
    );
  }

  // Único respaldo si el proceso muere antes del finally.
  console.warn(
    `[rc:probe-d] copia de "${HOJA}" antes de la prueba (${filasOriginales.length} filas):`,
    JSON.stringify(filasOriginales),
  );

  const restaurar = async () => {
    await reemplazarHoja(HOJA, ENCABEZADOS_CONFIG_SUCURSALES, filasOriginales);
    invalidarHojas();
  };

  try {
    const conAppsScript = await correrSecuencia((body) =>
      conReintentoIdempotente(appsScriptPost, body),
    );
    await restaurar();
    const conSdk = await correrSecuencia((body) => SDK_POST[body.action](body));

    const pasos = SECUENCIA.map((s, i) => {
      const as = conAppsScript[i];
      const sdk = conSdk[i];
      return {
        paso: s.nombre,
        filasDePrueba: { appsScript: as.dePrueba.length, sdk: sdk.dePrueba.length },
        diferencias: comparar(as.dePrueba, sdk.dePrueba),
        // Las filas reales se comparan contra la copia original, no entre
        // backends: lo que importa es que ninguno las haya tocado.
        realesIntactasAppsScript: comparar(as.reales, filasOriginales).length === 0,
        realesIntactasSdk: comparar(sdk.reales, filasOriginales).length === 0,
        mismaRespuesta:
          JSON.stringify(as.respuesta ?? as.error) === JSON.stringify(sdk.respuesta ?? sdk.error),
        errorAppsScript: as.error,
        errorSdk: sdk.error,
      };
    });

    const errores = [];
    for (const caso of CASOS_ERROR) {
      const cap = async (fn) => {
        try {
          return "no fallo: " + JSON.stringify(await fn(caso.body));
        } catch (err) {
          return err.message || String(err);
        }
      };
      const as = await cap(appsScriptPost);
      const sdk = await cap((b) => SDK_POST[b.action](b));
      errores.push({ caso: caso.nombre, appsScript: as, sdk, igual: as === sdk });
    }

    const conDif = pasos.filter((p) => p.diferencias.length);
    const tocaronReales = pasos.filter((p) => !p.realesIntactasAppsScript || !p.realesIntactasSdk);
    const respDistintas = pasos.filter((p) => !p.mismaRespuesta);
    const erroresDistintos = errores.filter((e) => !e.igual);
    const escribioAlgo = pasos.some((p) => p.filasDePrueba.sdk > 0);

    return NextResponse.json({
      veredicto: !escribioAlgo
        ? "no se escribio nada: la prueba no verifica nada"
        : conDif.length || tocaronReales.length || erroresDistintos.length || respDistintas.length
          ? "hay diferencias"
          : `las ${pasos.length} etapas coinciden, las ${filasOriginales.length} filas reales quedaron intactas y los errores coinciden`,
      resumen: {
        etapas: pasos.length,
        etapasConDiferencias: conDif.length,
        etapasQueTocaronFilasReales: tocaronReales.length,
        respuestasDistintas: respDistintas.length,
        erroresDistintos: erroresDistintos.length,
        filasRealesEnLaHoja: filasOriginales.length,
      },
      pasos,
      errores,
    });
  } finally {
    try {
      await restaurar();
      const final = await leerHoja(HOJA, { crudo: true });
      const quedan = final.slice(1).filter(esDePrueba).length;
      if (quedan) console.error(`[rc:probe-d] quedaron ${quedan} filas de prueba en "${HOJA}"`);
    } catch (err) {
      console.error(`[rc:probe-d] NO SE PUDO RESTAURAR "${HOJA}". Copia:`, JSON.stringify(filasOriginales), err);
    }
  }
}
