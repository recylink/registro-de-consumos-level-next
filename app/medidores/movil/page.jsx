import { AvisoDatos } from "@/components/ui/avisos";
import { MedidoresMovil } from "@/components/views/medidores-movil";
import { loadMedidores, loadSucursales } from "@/lib/data";
import { currentMonthKey, monthsWindow } from "@/lib/domain/periods";

export const metadata = { title: "Registro móvil" };

export default async function MedidoresMovilPage() {
  const [medidores, sucursales] = await Promise.all([loadMedidores(), loadSucursales()]);
  const mesActual = currentMonthKey();

  return (
    <div>
      <AvisoDatos configured={medidores.configured} error={medidores.error || sucursales.error} />
      {/* En terreno solo se cargan lecturas y fotos: los registros globales (que
          alimentan "Total boleta") no hacen falta acá. */}
      <MedidoresMovil
        medidores={medidores.data}
        sucursales={sucursales.data}
        mesActual={mesActual}
        meses={monthsWindow(mesActual, 12)}
      />
    </div>
  );
}
