import { AvisoDatos } from "@/components/ui/avisos";
import { Factores } from "@/components/views/factores";
import { loadEmissions, loadSucursales } from "@/lib/data";
import { mergeEmissions } from "@/lib/domain/emisiones";
import { currentMonthKey } from "@/lib/domain/periods";

export const metadata = { title: "Factores de emisión" };

export default async function FactoresPage() {
  const [emissions, sucursales] = await Promise.all([loadEmissions(), loadSucursales()]);

  return (
    <div>
      <AvisoDatos configured={sucursales.configured} error={sucursales.error || emissions.error} />
      <Factores
        emissions={mergeEmissions(emissions.data)}
        sucursales={sucursales.data}
        // Mes al que se atribuye una recarga de refrigerante nueva.
        mesActual={currentMonthKey()}
      />
    </div>
  );
}
