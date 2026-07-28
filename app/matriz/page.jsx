import { AvisoDatos } from "@/components/ui/avisos";
import { Matriz } from "@/components/views/matriz";
import { loadRecords, loadSucursales } from "@/lib/data";
import { currentMonthKey, monthsWindow } from "@/lib/domain/periods";

export const metadata = { title: "Estado de carga por sucursal" };

export default async function MatrizPage() {
  const [records, sucursales] = await Promise.all([loadRecords(), loadSucursales()]);
  const mesActual = currentMonthKey();

  return (
    <div>
      <AvisoDatos configured={records.configured} error={records.error || sucursales.error} />
      <Matriz
        sucursales={sucursales.data}
        records={records.data}
        // Más reciente primero, que es el mes que se suele revisar.
        meses={monthsWindow(mesActual, 12).reverse()}
        mesActual={mesActual}
      />
    </div>
  );
}
