import { AvisoDatos } from "@/components/ui/avisos";
import { Subir } from "@/components/views/subir";
import { loadSucursales } from "@/lib/data";

export const metadata = { title: "Subir documento" };

export default async function SubirPage() {
  const sucursales = await loadSucursales();

  return (
    <div>
      <AvisoDatos configured={sucursales.configured} error={sucursales.error} />
      <Subir
        sucursales={sucursales.data}
        // Tope del selector de fecha de la tabla de revisión, fijado en el
        // servidor para no depender del reloj del navegador.
        hoy={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
