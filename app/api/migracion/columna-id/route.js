import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/apps-script";
import { LAYOUT_REGISTROS } from "@/lib/sheets/records";
import { nextConsumoId } from "@/lib/domain/ids";
import { SDK_POST } from "@/lib/google/actions";
import {
  asegurarAncho,
  contadorLlamadas,
  escribirCeldas,
  existeHoja,
  invalidarHojas,
  leerHoja,
  letraColumna,
  reiniciarContador,
} from "@/lib/google/sheets-api";

// Migración: agrega la columna "ID" a las tres hojas de consumo y le pone un id a
// cada fila existente.
//
//   curl -s  http://localhost:3000/api/migracion/columna-id                 # informe
//   curl -s -X POST 'http://localhost:3000/api/migracion/columna-id?aplicar=si'
//
// POR QUÉ
//
// Una hoja de cálculo no tiene claves primarias, así que la identidad de un registro
// era su posición: `comb-12` significaba "la fila 14 de Combustible". Ordenar la
// planilla o borrar una fila invalida todos los ids de golpe, y una edición escrita
// en la fila equivocada no produce ningún error — solo un dato mal puesto que nadie
// ve hasta que alguien lo audita. Con la columna ID, la fila se busca por su
// identidad y el orden de la planilla deja de importar.
//
// CÓMO, Y POR QUÉ ASÍ
//
// 1. La columna va AL FINAL. Es la única posición que no corre ninguna columna
//    existente; el resto del código lee por índice (`LAYOUT` en records.js) y una
//    inserción en la A habría roto los tres parsers en silencio.
//
// 2. Solo escribe celdas VACÍAS de la columna ID. Es lo que hace la migración
//    idempotente: correrla dos veces no cambia ningún id ya asignado, y correrla
//    después de que se hayan agregado filas nuevas completa solo esas.
//
// 3. Al terminar deja `registrosConId: true` en la hoja "Config". Ese flag es lo que
//    enciende la escritura de ids en los `append` de la app (ver `registrosConId` en
//    lib/sheets/records.js). Antes de que exista, la app escribe filas del ancho
//    viejo, así que una instancia sin migrar sigue funcionando igual que siempre.
//    El flag se escribe ÚLTIMO, para que un fallo a mitad de camino no deje a la app
//    escribiendo en una columna que no terminó de crearse.
//
// 4. El informe (GET) no escribe nada. Reporta hoja por hoja: si la columna existe,
//    cuántas filas hay, cuántas les falta el id, y si ya hay ids repetidos.
//
// Lo que NO hace, y hay que hacer a mano antes: el respaldo. Duplicar la planilla
// (Archivo → Hacer una copia) toma diez segundos y es la única vuelta atrás real.

// SOLO EN DESARROLLO, igual que el resto de /api/migracion/. Acá importa más que en
// las otras: el POST escribe en la planilla real. Desplegado, la única protección
// sería `SITE_PASSWORD` —una contraseña compartida, y si no está configurada, ninguna—,
// así que un endpoint de escritura no tiene por qué existir en el deploy. Se corre
// local, contra la misma planilla, con las credenciales de `.env.local`.

export const dynamic = "force-dynamic";

const CLAVE_FLAG = "registrosConId";

function soloDesarrollo() {
  if (process.env.NODE_ENV !== "production") return null;
  return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
}

/** Estado de una hoja respecto de la migración. Sin escribir nada. */
async function inspeccionar(l) {
  if (!(await existeHoja(l.sheet))) {
    return { hoja: l.sheet, existe: false };
  }

  const filas = await leerHoja(l.sheet, { crudo: true });
  const encabezado = filas[0] || [];
  const datos = filas.slice(1);

  const etiqueta = String(encabezado[l.colId - 1] ?? "").trim();
  const ids = new Map();
  let sinId = 0;
  let vacias = 0;

  datos.forEach((fila, i) => {
    // Una fila sin ningún dato no es un registro y no lleva id. Se usa el mismo
    // criterio que `toRecord`: sin fecha y sin consumo, no cuenta.
    const conDatos = (fila || []).some((c) => String(c ?? "").trim() !== "");
    if (!conDatos) {
      vacias++;
      return;
    }
    const id = String((fila || [])[l.colId - 1] ?? "").trim();
    if (!id) {
      sinId++;
      return;
    }
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(i + 2); // número de fila en la planilla
  });

  const repetidos = [...ids.entries()]
    .filter(([, filas]) => filas.length > 1)
    .map(([id, filas]) => ({ id, filas }));

  return {
    hoja: l.sheet,
    existe: true,
    columnaId: { numero: l.colId, letra: letraColumna(l.colId), etiqueta, conEtiqueta: etiqueta === "ID" },
    filasConDatos: datos.length - vacias,
    filasVacias: vacias,
    conId: ids.size,
    sinId,
    repetidos,
  };
}

export async function GET() {
  const bloqueado = soloDesarrollo();
  if (bloqueado) return bloqueado;

  reiniciarContador();
  const hojas = [];
  for (const l of LAYOUT_REGISTROS) hojas.push(await inspeccionar(l));

  const faltan = hojas.reduce((n, h) => n + (h.existe ? h.sinId : 0), 0);
  const repetidos = hojas.reduce((n, h) => n + (h.existe ? h.repetidos.length : 0), 0);

  return NextResponse.json({
    modo: "informe",
    aplicaria: {
      etiquetasAEscribir: hojas.filter((h) => h.existe && !h.columnaId.conEtiqueta).map((h) => h.hoja),
      idsABackfillear: faltan,
    },
    // Un id repetido no lo arregla esta migración: elegir cuál conservar es una
    // decisión sobre los datos, no mecánica. Se reporta para que se resuelva a mano.
    idsRepetidos: repetidos,
    hojas,
    llamadas: contadorLlamadas(),
    siguiente:
      faltan || hojas.some((h) => h.existe && !h.columnaId.conEtiqueta)
        ? "POST con ?aplicar=si"
        : "nada por hacer",
    recorda: "Duplicar la planilla antes de aplicar. Es la única vuelta atrás.",
  });
}

export async function POST(req) {
  const bloqueado = soloDesarrollo();
  if (bloqueado) return bloqueado;

  const url = new URL(req.url);
  if (url.searchParams.get("aplicar") !== "si") {
    return NextResponse.json(
      {
        error:
          "Falta ?aplicar=si. Sin ese parámetro esto no escribe nada — es a propósito, " +
          "para que un POST accidental no toque la planilla. Correr el GET primero.",
      },
      { status: 400 },
    );
  }

  reiniciarContador();
  const resultado = [];

  for (const l of LAYOUT_REGISTROS) {
    const antes = await inspeccionar(l);
    if (!antes.existe) {
      resultado.push({ hoja: l.sheet, saltada: "la hoja no existe" });
      continue;
    }

    // La grilla tiene que llegar hasta la columna ID: escribir más allá es un 400,
    // no una extensión automática.
    const columnasAgregadas = await asegurarAncho(l.sheet, l.colId);

    const celdas = [];
    if (!antes.columnaId.conEtiqueta) {
      celdas.push({ row: 1, col: l.colId, value: "ID" });
    }

    // Se relee después de asegurar el ancho: `leerHoja` devuelve filas recortadas al
    // último dato, y el índice de fila tiene que salir de la misma lectura que decide
    // qué falta.
    const filas = await leerHoja(l.sheet, { crudo: true });
    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i] || [];
      const conDatos = fila.some((c) => String(c ?? "").trim() !== "");
      if (!conDatos) continue;
      const actual = String(fila[l.colId - 1] ?? "").trim();
      if (actual) continue; // ya tiene id: no se toca. Acá vive la idempotencia.
      celdas.push({ row: i + 1, col: l.colId, value: nextConsumoId(l.idPrefix) });
    }

    await escribirCeldas(l.sheet, celdas);
    invalidarHojas();

    const despues = await inspeccionar(l);
    resultado.push({
      hoja: l.sheet,
      columnasAgregadas,
      etiquetaEscrita: !antes.columnaId.conEtiqueta,
      idsEscritos: celdas.length - (antes.columnaId.conEtiqueta ? 0 : 1),
      // Verificación posterior sobre los datos, no sobre lo que creímos escribir.
      verificacion: {
        filasConDatos: despues.filasConDatos,
        conId: despues.conId,
        sinId: despues.sinId,
        repetidos: despues.repetidos.length,
        ok: despues.sinId === 0 && despues.columnaId.conEtiqueta && !despues.repetidos.length,
      },
    });
  }

  const todoOk = resultado.every((r) => r.saltada || r.verificacion.ok);

  // El flag va al final y solo si todo verificó: es lo que enciende la escritura de
  // ids en los append de la app, y encenderlo a medias sería peor que no encenderlo.
  let flag = "no escrito";
  if (todoOk) {
    await SDK_POST.setConfig({ key: CLAVE_FLAG, value: true });
    flag = `${CLAVE_FLAG} = true`;
    // Sin esto el flag queda escrito pero la app sigue leyendo el valor cacheado
    // (300s), así que los append de los próximos minutos no llevarían id. Y los
    // registros cambiaron de identidad: sus ids ahora salen de la columna.
    revalidateTag(TAGS.config);
    revalidateTag(TAGS.records);
  }

  return NextResponse.json({
    modo: "aplicado",
    ok: todoOk,
    flag,
    resultado,
    llamadas: contadorLlamadas(),
    siguiente: todoOk
      ? "Listo. Los append nuevos ya escriben id. Volver a correr el GET para confirmar."
      : "Alguna hoja no verificó: revisar `resultado` y NO se encendió el flag.",
  });
}
