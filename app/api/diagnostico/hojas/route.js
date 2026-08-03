import { NextResponse } from "next/server";
import { hojas, leerHoja } from "@/lib/google/sheets-api";

// Inventario de la planilla: qué hojas hay, cuántas filas de datos tiene cada una
// y si su encabezado coincide con el que la app espera.
//
//   curl -s http://localhost:3000/api/diagnostico/hojas
//
// Sirve para dos cosas: saber qué hojas se pueden usar en pruebas sin arriesgar
// datos, y detectar encabezados que se hayan desalineado de ENCABEZADOS.
//
// Solo lectura.

import {
  ENCABEZADOS,
  ENCABEZADOS_CONFIG,
  ENCABEZADOS_CONFIG_SUCURSALES,
  ENCABEZADOS_EMISIONES,
} from "@/lib/google/headers";
import { SHEETS } from "@/lib/instance";

export const dynamic = "force-dynamic";

const ESPERADOS = {
  ...ENCABEZADOS,
  [SHEETS.CONFIG]: ENCABEZADOS_CONFIG,
  [SHEETS.CONFIG_SUCURSALES]: ENCABEZADOS_CONFIG_SUCURSALES,
  [SHEETS.EMISIONES]: ENCABEZADOS_EMISIONES,
};

export async function GET() {
  const lista = await hojas();
  const detalle = [];

  for (const h of lista) {
    const grilla = await leerHoja(h.titulo, { crudo: true });
    const filasConDatos = grilla.slice(1).filter((f) => f.some((c) => c !== "" && c != null));
    const encabezadoReal = grilla[0] || [];
    const esperado = ESPERADOS[h.titulo];
    detalle.push({
      hoja: h.titulo,
      filasDeDatos: filasConDatos.length,
      vacia: filasConDatos.length === 0,
      laConoceLaApp: !!esperado,
      encabezadoCoincide: esperado
        ? JSON.stringify(encabezadoReal.slice(0, esperado.length)) === JSON.stringify(esperado)
        : null,
      encabezadoReal: esperado && JSON.stringify(encabezadoReal.slice(0, esperado.length)) !== JSON.stringify(esperado)
        ? encabezadoReal
        : undefined,
    });
  }

  const desalineadas = detalle.filter((d) => d.encabezadoCoincide === false);
  const faltantes = Object.keys(ESPERADOS).filter((n) => !lista.some((h) => h.titulo === n));

  return NextResponse.json({
    resumen: {
      hojas: detalle.length,
      vacias: detalle.filter((d) => d.vacia).length,
      desconocidasParaLaApp: detalle.filter((d) => !d.laConoceLaApp).map((d) => d.hoja),
      encabezadosDesalineados: desalineadas.map((d) => d.hoja),
      hojasQueLaAppEsperaYNoEstan: faltantes,
    },
    detalle,
  });
}
