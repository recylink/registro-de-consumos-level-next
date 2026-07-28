import { AvisoDatos } from "@/components/ui/avisos";
import { Dashboard } from "@/components/views/dashboard";
import { loadRecords, loadSucursales } from "@/lib/data";
import { currentMonthKey } from "@/lib/domain/periods";

export const metadata = { title: "Consumos registrados" };

export default async function DashboardPage() {
  const [records, sucursales] = await Promise.all([loadRecords(), loadSucursales()]);

  return (
    <div>
      <AvisoDatos configured={records.configured} error={records.error || sucursales.error} />
      <Dashboard
        records={records.data}
        sucursales={sucursales.data}
        // Ancla de todos los períodos. Se fija en el servidor para que el HTML
        // que se envía y el que hidrata el navegador coincidan.
        mesActual={currentMonthKey()}
      />
    </div>
  );
}
