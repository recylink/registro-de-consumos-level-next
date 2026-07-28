import { AvisoDatos } from "@/components/ui/avisos";
import { Metas } from "@/components/views/metas";
import { loadEmissions, loadRecords, loadSucursales } from "@/lib/data";
import { mergeEmissions } from "@/lib/domain/emisiones";
import { currentMonthKey } from "@/lib/domain/periods";

export const metadata = { title: "Metas de reducción" };

export default async function MetasPage() {
  const [emissions, records, sucursales] = await Promise.all([
    loadEmissions(),
    loadRecords(),
    loadSucursales(),
  ]);

  return (
    <div>
      <AvisoDatos configured={sucursales.configured} error={sucursales.error || records.error} />
      <Metas
        emissions={mergeEmissions(emissions.data)}
        records={records.data}
        sucursales={sucursales.data}
        mesActual={currentMonthKey()}
        // El año se fija en el servidor: la lista de años base llega hasta el
        // último año calendario completo.
        anioActual={new Date().getFullYear()}
      />
    </div>
  );
}
