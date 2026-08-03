import { NextResponse } from "next/server";
import { appsScriptGet } from "@/lib/apps-script";
import { SDK_GET } from "@/lib/google/actions";

// Verificación de la migración: corre la MISMA action de lectura por los dos
// backends, ignorando RC_SDK_ACTIONS, y compara las respuestas celda por celda.
//
//   curl -s "http://localhost:3000/api/migracion/diff"              # todas
//   curl -s "http://localhost:3000/api/migracion/diff?action=read"  # una
//
// Es la única forma honesta de decir "esta action ya está migrada": que devuelva
// exactamente lo mismo sobre los datos reales. Un diff vacío es la prueba; que la
// pantalla "se vea bien" no lo es, porque las diferencias de esta migración son
// silenciosas (una fila más corta, un número sin formato, una fecha como serial).
//
// Solo en desarrollo: hace dos lecturas completas de la planilla por llamada y no
// tiene nada que hacer en producción.

export const dynamic = "force-dynamic";

// Las actions que necesitan parámetros no se pueden probar a ciegas. Estas son
// las claves que la app realmente pide (lib/drive-folders.js, lib/sheets/config-store.js).
const PARAMS = {
  getConfig: [{ key: "driveFolders" }, { key: "fotoNotifEmails" }],
};

const MAX_DIFS = 25;

/** Diferencias entre dos valores, como rutas legibles. Corta en MAX_DIFS. */
function comparar(a, b, ruta = "", difs = []) {
  if (difs.length >= MAX_DIFS) return difs;

  const tipo = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
  if (tipo(a) !== tipo(b)) {
    difs.push({ ruta: ruta || "(raíz)", appsScript: tipo(a), sdk: tipo(b), motivo: "tipo distinto" });
    return difs;
  }

  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      difs.push({ ruta: ruta || "(raíz)", appsScript: `${a.length} elementos`, sdk: `${b.length} elementos`, motivo: "largo distinto" });
    }
    for (let i = 0; i < Math.max(a.length, b.length) && difs.length < MAX_DIFS; i++) {
      comparar(a[i], b[i], `${ruta}[${i}]`, difs);
    }
    return difs;
  }

  if (a && typeof a === "object") {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of claves) {
      if (difs.length >= MAX_DIFS) break;
      comparar(a[k], b[k], ruta ? `${ruta}.${k}` : k, difs);
    }
    return difs;
  }

  if (a !== b) {
    difs.push({ ruta: ruta || "(raíz)", appsScript: a, sdk: b, motivo: "valor distinto" });
  }
  return difs;
}

async function conReintento(fn, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      // Espera creciente: 300ms, 600ms.
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw ultimo;
}

async function correr(action, params) {
  const etiqueta = params ? `${action}(${JSON.stringify(params)})` : action;
  const salida = { action: etiqueta };

  // El /exec falla con "fetch failed" cada tantas llamadas seguidas — la
  // intermitencia que ya se venía notando. Sin reintento, el diff reporta como
  // diferencia lo que solo fue una caída de red del backend viejo.
  const [viejo, nuevo] = await Promise.allSettled([
    conReintento(() => appsScriptGet({ action, ...(params || {}) })),
    SDK_GET[action]({ action, ...(params || {}) }),
  ]);

  if (viejo.status === "rejected") salida.errorAppsScript = viejo.reason?.message || String(viejo.reason);
  if (nuevo.status === "rejected") salida.errorSdk = nuevo.reason?.message || String(nuevo.reason);
  if (viejo.status === "rejected" || nuevo.status === "rejected") {
    salida.iguales = false;
    return salida;
  }

  const difs = comparar(viejo.value, nuevo.value);
  salida.iguales = difs.length === 0;
  if (difs.length) {
    salida.diferencias = difs;
    salida.truncado = difs.length >= MAX_DIFS;
  }
  // Cuántas celdas se compararon de verdad. Sin esto, "iguales: true" sobre dos
  // respuestas vacías se lee como verificado y no lo está: la hoja "Emisiones"
  // no existe en esta planilla, así que ambos backends devuelven [] y coincidir
  // no demuestra que la traducción sea correcta.
  salida.celdas = contarCeldas(viejo.value);
  salida.verificada = salida.iguales && salida.celdas > 0;
  if (salida.iguales && salida.celdas === 0) {
    salida.aviso = "ambos backends devolvieron vacío: coincide, pero no prueba nada";
  }
  return salida;
}

/** Celdas hoja en la respuesta, sin importar su forma ({rows}, objeto por hoja, escalar). */
function contarCeldas(v) {
  if (v == null) return 0;
  if (Array.isArray(v)) return v.reduce((n, x) => n + contarCeldas(x), 0);
  if (typeof v === "object") return Object.values(v).reduce((n, x) => n + contarCeldas(x), 0);
  return v === "" ? 0 : 1;
}

export async function GET(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }

  const pedida = new URL(request.url).searchParams.get("action");
  const nombres = pedida ? [pedida] : Object.keys(SDK_GET);

  const desconocidas = nombres.filter((n) => !SDK_GET[n]);
  if (desconocidas.length) {
    return NextResponse.json(
      { error: `sin implementación en el SDK: ${desconocidas.join(", ")}`, disponibles: Object.keys(SDK_GET) },
      { status: 400 },
    );
  }

  const resultados = [];
  for (const action of nombres) {
    for (const params of PARAMS[action] || [null]) {
      resultados.push(await correr(action, params));
    }
  }

  const distintas = resultados.filter((r) => !r.iguales);
  const sinDatos = resultados.filter((r) => r.iguales && !r.verificada);
  return NextResponse.json({
    resumen: {
      probadas: resultados.length,
      verificadas: resultados.filter((r) => r.verificada).length,
      distintas: distintas.length,
      coincidenSinDatos: sinDatos.length,
      veredicto:
        distintas.length > 0
          ? "hay diferencias"
          : sinDatos.length > 0
            ? "coinciden, pero " + sinDatos.length + " sin datos que comparar"
            : "todas verificadas con datos reales",
    },
    resultados,
  });
}
