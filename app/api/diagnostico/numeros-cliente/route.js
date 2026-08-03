import { NextResponse } from "next/server";
import { readSucursales } from "@/lib/sheets/sucursales";
import { readRecords } from "@/lib/sheets/records";
import { leerHoja } from "@/lib/google/sheets-api";
import { normNumCliente, resolveByNumCliente } from "@/lib/domain/sucursales";
import { SHEETS } from "@/lib/instance";

// Mide el daño de los ceros a la izquierda en el N° de cliente.
//
//   curl -s http://localhost:3000/api/diagnostico/numeros-cliente
//
// El problema: la planilla guarda con USER_ENTERED (así se comporta setValues del
// Apps Script, medido en /api/migracion/probe-escritura), así que "0123" se
// almacena como el número 123 y el cero se pierde. Es preexistente, no lo
// introdujo la migración.
//
// Por qué importa: el N° de cliente es lo que rutea una boleta extraída a su
// sucursal (ver CONTEXT.md). Y los dos lados del match NO pasan por el mismo
// camino:
//
//   - el de la config viene de la planilla, ya sin el cero  →  "123"
//   - el de la boleta lo produce el parser del PDF al momento →  "0123"
//
// `normNumCliente` (lib/domain/sucursales.js:150) limpia puntos, espacios y dígito
// verificador, pero NO ceros a la izquierda. Así que no calzan y la boleta queda
// sin sucursal.
//
// Este endpoint es de solo lectura: no arregla nada, reporta.

export const dynamic = "force-dynamic";

/** ¿El valor perdió su forma de texto al guardarse? */
function esNumerico(v) {
  return typeof v === "number";
}

/** Igual salvo ceros a la izquierda: la firma de este bug. */
function calzaSoloSinCeros(a, b) {
  const na = normNumCliente(a);
  const nb = normNumCliente(b);
  if (!na || !nb || na === nb) return false;
  return na.replace(/^0+/, "") === nb.replace(/^0+/, "");
}

export async function GET() {
  const salida = { planilla: {}, hallazgos: {}, alcance: null };

  // --- Lo que hay guardado, con su tipo ---------------------------------
  // Crudo, no display: el tipo es el dato. Un N° de cliente que vuelve como
  // number ya pasó por la coerción numérica.
  const [configFilas, elec, agua, hojaNums] = await Promise.all([
    leerHoja(SHEETS.CONFIG_SUCURSALES, { crudo: true }),
    leerHoja(SHEETS.ELECTRICIDAD, { crudo: true }),
    leerHoja(SHEETS.AGUA, { crudo: true }),
    leerHoja("N° de cliente", { crudo: true }),
  ]);

  // Config Sucursales: "N° cliente" es la columna 14 (índice 13).
  const enConfig = configFilas
    .slice(1)
    .map((f, i) => ({ fila: i + 2, valor: f[13], sucursal: f[1] }))
    .filter((x) => x.valor !== "" && x.valor != null);

  // Registros: "Número de cliente" es la columna 2 en Electricidad y Agua.
  const enRegistros = [
    ...elec.slice(1).map((f, i) => ({ hoja: SHEETS.ELECTRICIDAD, fila: i + 2, valor: f[1] })),
    ...agua.slice(1).map((f, i) => ({ hoja: SHEETS.AGUA, fila: i + 2, valor: f[1] })),
  ].filter((x) => x.valor !== "" && x.valor != null);

  const enHojaNums = hojaNums
    .slice(1)
    .map((f, i) => ({ fila: i + 2, valor: f[0], sucursal: f[2] }))
    .filter((x) => x.valor !== "" && x.valor != null);

  const resumirGrupo = (lista) => ({
    total: lista.length,
    guardadosComoNumero: lista.filter((x) => esNumerico(x.valor)).length,
    sospechosos: lista
      .filter((x) => esNumerico(x.valor))
      .map((x) => ({ ...x, valor: x.valor, comoTexto: String(x.valor) })),
  });

  salida.planilla = {
    configSucursales: resumirGrupo(enConfig),
    registros: resumirGrupo(enRegistros),
    hojaNumeroDeCliente: resumirGrupo(enHojaNums),
  };

  // --- Evidencia directa: pares que calzan solo si se ignoran los ceros ---
  const paresRotos = [];
  for (const r of enRegistros) {
    for (const c of enConfig) {
      if (calzaSoloSinCeros(r.valor, c.valor)) {
        paresRotos.push({
          registro: { hoja: r.hoja, fila: r.fila, valor: r.valor },
          config: { fila: c.fila, sucursal: c.sucursal, valor: c.valor },
          nota: "calzan sin los ceros a la izquierda, no calzan como están",
        });
      }
    }
  }

  // --- Síntoma observable: registros que no resuelven a ninguna sucursal ---
  let sinResolver = [];
  try {
    const [sucursales, registros] = await Promise.all([readSucursales(), readRecords()]);
    sinResolver = registros
      .filter((r) => r.numeroCliente)
      .map((r) => ({
        id: r.id,
        numeroCliente: r.numeroCliente,
        sucursalEnLaFila: r.sucursal,
        resuelve: !!resolveByNumCliente(sucursales, r.numeroCliente, r.type),
      }))
      .filter((r) => !r.resuelve);
  } catch (err) {
    salida.hallazgos.errorAlResolver = err.message;
  }

  salida.hallazgos = {
    ...salida.hallazgos,
    paresQueSoloCalzanSinCeros: paresRotos,
    registrosQueNoResuelvenASucursal: sinResolver,
  };

  const numericos =
    salida.planilla.configSucursales.guardadosComoNumero +
    salida.planilla.registros.guardadosComoNumero +
    salida.planilla.hojaNumeroDeCliente.guardadosComoNumero;

  salida.alcance = {
    valoresGuardadosComoNumero: numericos,
    paresRotos: paresRotos.length,
    registrosSinRutear: sinResolver.length,
    veredicto:
      paresRotos.length > 0
        ? "hay evidencia directa de ceros perdidos que rompen el ruteo"
        : numericos > 0
          ? "hay N° de cliente guardados como número (en riesgo), pero ningún par roto detectable con los datos de esta planilla"
          : "ningún N° de cliente quedó guardado como número en esta planilla",
    // Un valor numérico sin cero a la izquierda no perdió nada: "123" y 123
    // normalizan igual. El riesgo es solo para los que empezaban con 0, y eso
    // ya no se puede saber desde la planilla — el original se perdió al escribir.
    limitacion:
      "desde la planilla no se puede distinguir un 123 que siempre fue 123 de un " +
      "0123 que perdió el cero: el valor original ya no está. Los pares rotos son " +
      "la única evidencia directa, y solo aparecen si el otro lado conservó el cero.",
  };

  return NextResponse.json(salida);
}
