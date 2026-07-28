import { AvisoDatos } from "@/components/ui/avisos";
import { ManualFlujo } from "@/components/views/manual";
import { loadRecords, loadSucursales } from "@/lib/data";
import { currentMonthKey } from "@/lib/domain/periods";

export const metadata = { title: "Registro manual" };

export default async function ManualPage() {
  const [sucursales, records] = await Promise.all([loadSucursales(), loadRecords()]);

  return (
    <div>
      <AvisoDatos configured={sucursales.configured} error={sucursales.error} />
      <ManualFlujo
        sucursales={sucursales.data}
        // Los registros solo se usan para detectar consumos atípicos contra el
        // promedio histórico de la misma sucursal, tipo y subcategoría.
        records={records.data}
        // El mes tope del selector se fija en el servidor, para que el límite no
        // dependa del reloj del navegador.
        mesActual={currentMonthKey()}
      />
    </div>
  );
}
