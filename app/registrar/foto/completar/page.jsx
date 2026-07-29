import Link from "next/link";
import { FotoCompletar } from "@/components/views/foto-completar";
import { SectionHead } from "@/components/ui/layout";
import { loadFotos, loadSucursales } from "@/lib/data";
import { currentMonthKey } from "@/lib/domain/periods";

export const metadata = { title: "Completar foto" };

// Qué foto completar viene en la URL (?fila=N, el número de fila de la hoja).
// En el prototipo era un campo del estado global, así que la pantalla no era
// enlazable y un refresh la perdía.
export default async function CompletarFotoPage({ searchParams }) {
  const { fila } = await searchParams;
  const rowIndex = parseInt(fila, 10);

  const [fotos, sucursales] = await Promise.all([loadFotos(), loadSucursales()]);
  const row = fotos.data.find((r) => r.rowIndex === rowIndex);

  if (!row) {
    return (
      <div>
        <SectionHead
          eyebrow="Completar"
          title="Foto no encontrada"
          sub={
            fotos.configured
              ? "La fila indicada no está en la cola: puede haberse procesado ya."
              : "Esta instancia no tiene backend configurado, así que no hay cola que leer."
          }
        />
        <Link className="prt-btn" href="/registrar/foto">Volver a la cola</Link>
      </div>
    );
  }

  return <FotoCompletar row={row} sucursales={sucursales.data} mesActual={currentMonthKey()} />;
}
