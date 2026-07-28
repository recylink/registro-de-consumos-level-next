import { AvisoDatos } from "@/components/ui/avisos";
import { Impacto } from "@/components/views/impacto";
import { loadEmissions, loadRecords, loadSucursales } from "@/lib/data";
import { mergeEmissions } from "@/lib/domain/emisiones";
import { currentMonthKey } from "@/lib/domain/periods";

export const metadata = { title: "Huella de emisiones GEI" };

export default async function ImpactoPage() {
  const [records, sucursales, emissions] = await Promise.all([
    loadRecords(),
    loadSucursales(),
    loadEmissions(),
  ]);

  return (
    <div>
      <AvisoDatos configured={records.configured} error={records.error || sucursales.error} />
      <Impacto
        records={records.data}
        sucursales={sucursales.data}
        // La planilla guarda solo los valores numéricos; label, unidad, alcance y
        // fuente de cada factor vienen del catálogo. mergeEmissions los combina y,
        // si la hoja está vacía, deja la semilla con los factores por defecto.
        emissions={mergeEmissions(emissions.data)}
        mesActual={currentMonthKey()}
      />
    </div>
  );
}
