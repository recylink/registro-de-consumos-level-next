import { NextResponse } from "next/server";
import { appsScriptPost } from "@/lib/apps-script";
import { SDK_POST } from "@/lib/google/actions";
import { ENCABEZADOS } from "@/lib/google/headers";
import { borrarHoja, hojas, invalidarHojas, leerHoja } from "@/lib/google/sheets-api";

// Verifica el bloque G: `init` (crear las hojas que falten, con su encabezado).
//
//   curl -s -X POST http://localhost:3000/api/migracion/probe-g
//
// Dos cosas que probar, y la segunda es la que cuesta:
//
// 1. Que sea idempotente: con todas las hojas presentes, `init` no debe tocar
//    nada. Fácil, porque es el estado normal de la planilla.
// 2. Que CREE la hoja con el encabezado correcto. Para eso hay que provocar la
//    ausencia de una hoja, y no se puede elegir cualquiera: `init` recorre una
//    lista fija. Se usa una hoja de esa lista que esté VACÍA, se borra, se deja
//    que cada backend la recree y se comparan los encabezados.
//
// Si la hoja elegida tuviera datos, la prueba se niega a correr.
//
// EFECTO SECUNDARIO que no se revierte: la hoja recreada queda como última
// pestaña de la planilla, no en su posición original. Los dos backends la crean al
// final (insertSheet y addSheet hacen lo mismo), así que restaurar el orden
// requeriría un paso aparte. El contenido y el encabezado sí quedan idénticos.
//
// Solo en desarrollo.

export const dynamic = "force-dynamic";

// Candidatas por orden de preferencia: hojas que la app conoce y que en la
// práctica están vacías. Se toma la primera que esté realmente sin datos.
const CANDIDATAS = ["Fill out", "N° de cliente", "Fotos"];

async function estado() {
  invalidarHojas();
  const lista = (await hojas()).map((h) => h.titulo).sort();
  return lista;
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  const presentes = new Set(await estado());
  const faltantes = Object.keys(ENCABEZADOS).filter((n) => !presentes.has(n));

  // --- 1. Idempotencia con todo presente -------------------------------
  const antes = await estado();
  let idem;
  try {
    const as = await appsScriptPost({ action: "init" });
    const listaTrasAs = await estado();
    const sdk = await SDK_POST.init({ action: "init" });
    const listaTrasSdk = await estado();
    idem = {
      respuestaAppsScript: as,
      respuestaSdk: sdk,
      mismaRespuesta: JSON.stringify(as) === JSON.stringify(sdk),
      hojasSinCambios:
        JSON.stringify(antes) === JSON.stringify(listaTrasAs) &&
        JSON.stringify(antes) === JSON.stringify(listaTrasSdk),
      // `init` no crea "Config", "Config Sucursales" ni "Emisiones": las crean sus
      // setters. Si alguna apareciera acá, la lista de ENCABEZADOS se desalineó.
      noDeberiaCrear: ["Config", "Config Sucursales", "Emisiones"].filter(
        (n) => !presentes.has(n) && listaTrasSdk.includes(n),
      ),
    };
  } catch (err) {
    idem = { error: err.message };
  }

  // --- 2. Creación con encabezado --------------------------------------
  let creacion = { probada: false };
  const elegida = [];
  for (const n of CANDIDATAS) {
    if (!presentes.has(n)) continue;
    const grilla = await leerHoja(n, { crudo: true });
    const conDatos = grilla.slice(1).filter((f) => f.some((c) => c !== "" && c != null));
    if (conDatos.length === 0) {
      elegida.push(n);
      break;
    }
  }

  if (!elegida.length) {
    creacion = {
      probada: false,
      motivo:
        "ninguna de las hojas candidatas está vacía; no se borra una hoja con datos " +
        `para probar. Candidatas: ${CANDIDATAS.join(", ")}`,
    };
  } else {
    const hoja = elegida[0];
    try {
      // El Apps Script la recrea.
      await borrarHoja(hoja);
      const existiaTrasBorrar = (await estado()).includes(hoja);
      await appsScriptPost({ action: "init" });
      invalidarHojas();
      const encAs = (await leerHoja(hoja, { crudo: true }))[0] || [];

      // El SDK la recrea.
      await borrarHoja(hoja);
      await SDK_POST.init({ action: "init" });
      invalidarHojas();
      const encSdk = (await leerHoja(hoja, { crudo: true }))[0] || [];

      const esperado = ENCABEZADOS[hoja];
      creacion = {
        probada: true,
        hoja,
        seBorroDeVerdad: existiaTrasBorrar === false,
        encabezadoAppsScript: encAs,
        encabezadoSdk: encSdk,
        coinciden: JSON.stringify(encAs) === JSON.stringify(encSdk),
        coincideConLoEsperado: JSON.stringify(encSdk) === JSON.stringify(esperado),
      };
    } catch (err) {
      creacion = { probada: true, hoja, error: err.message };
    } finally {
      // Que la hoja quede como estaba: presente y con su encabezado.
      try {
        invalidarHojas();
        if (!(await estado()).includes(elegida[0])) {
          await SDK_POST.init({ action: "init" });
        }
      } catch (err) {
        console.error("[rc:probe-g] no se pudo restaurar", elegida[0], err);
      }
    }
  }

  const final = await estado();
  const todoBien =
    !idem.error &&
    idem.mismaRespuesta &&
    idem.hojasSinCambios &&
    idem.noDeberiaCrear.length === 0 &&
    creacion.probada &&
    !creacion.error &&
    creacion.coinciden &&
    creacion.coincideConLoEsperado &&
    JSON.stringify(final) === JSON.stringify(antes);

  return NextResponse.json({
    veredicto: todoBien
      ? `init coincide: idempotente, y recrea "${creacion.hoja}" con el mismo encabezado que el Apps Script`
      : !creacion.probada
        ? "idempotencia verificada, creación NO probada: " + creacion.motivo
        : "hay diferencias",
    hojasQueFaltabanAlEmpezar: faltantes,
    planillaRestaurada: JSON.stringify(final) === JSON.stringify(antes),
    idempotencia: idem,
    creacion,
  });
}
