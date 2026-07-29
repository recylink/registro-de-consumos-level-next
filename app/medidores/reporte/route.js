import { medidoresReporteHtml } from "@/lib/reportes/medidores-html";
import { loadEmissions, loadMedidores, loadRecords, loadSucursales } from "@/lib/data";
import { mergeEmissions } from "@/lib/domain/emisiones";
import { currentMonthKey } from "@/lib/domain/periods";
import { MED_TYPES } from "@/lib/domain/medidores-calc";

// Reporte "Estado de medidores" como página propia. Se abre desde la pestaña
// Resumen con la selección actual en la query:
//   /medidores/reporte?sucursal=…&tipo=…&period=6m&anchor=2026-07&medidores=id,id
//
// Lee los datos de la planilla, no del estado del navegador: la pantalla fuerza
// el guardado pendiente antes de abrir el link.

export const dynamic = "force-dynamic";

export async function GET(request) {
  const q = request.nextUrl.searchParams;
  const sucursal = q.get("sucursal") || "";
  const tipo = q.get("tipo") || "";

  if (!sucursal || !MED_TYPES[tipo]) {
    return new Response("Faltan los parámetros sucursal y tipo.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const [medidores, records, sucursales, emissions] = await Promise.all([
    loadMedidores(),
    loadRecords(),
    loadSucursales(),
    loadEmissions(),
  ]);

  const html = medidoresReporteHtml({
    M: medidores.data,
    records: records.data,
    sucursales: sucursales.data,
    emissions: mergeEmissions(emissions.data),
    sucursal,
    tipo,
    // Vacío = todos los medidores activos de la (sucursal, tipo).
    meterIds: (q.get("medidores") || "").split(",").filter(Boolean),
    period: q.get("period") || "3m",
    anchor: q.get("anchor") || currentMonthKey(),
  });

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
