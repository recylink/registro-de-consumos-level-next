import { AvisoDatos } from "@/components/ui/avisos";
import { Medidores } from "@/components/views/medidores";
import { loadMedidores, loadRecords, loadSucursales } from "@/lib/data";
import { currentMonthKey, monthsWindow } from "@/lib/domain/periods";

export const metadata = { title: "Lecturas de medidores" };

export default async function MedidoresPage() {
  const [medidores, records, sucursales] = await Promise.all([
    loadMedidores(),
    loadRecords(),
    loadSucursales(),
  ]);
  const mesActual = currentMonthKey();

  return (
    <div>
      <AvisoDatos
        configured={medidores.configured}
        error={medidores.error || sucursales.error || records.error}
      />
      <Medidores
        medidores={medidores.data}
        // Los registros globales alimentan la fila "Total boleta": contra ellos se
        // compara la suma calculada de los medidores.
        records={records.data}
        sucursales={sucursales.data}
        mesActual={mesActual}
        meses={monthsWindow(mesActual, 12)}
      />
    </div>
  );
}
