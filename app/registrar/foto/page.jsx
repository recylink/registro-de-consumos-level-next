import { AvisoDatos } from "@/components/ui/avisos";
import { FotoHub } from "@/components/views/foto-hub";
import { loadFotos, loadSucursales } from "@/lib/data";
import { currentMonthKey } from "@/lib/domain/periods";

export const metadata = { title: "Tomar foto" };

export default async function FotoPage() {
  const [fotos, sucursales] = await Promise.all([loadFotos(), loadSucursales()]);

  return (
    <div>
      <AvisoDatos configured={fotos.configured} error={sucursales.error} />
      <FotoHub
        fotos={fotos.data}
        // El error de la cola se muestra dentro de la pestaña, no arriba: la
        // captura de una foto nueva funciona igual aunque la lectura falle.
        error={fotos.error}
        sucursales={sucursales.data}
        mesActual={currentMonthKey()}
      />
    </div>
  );
}
