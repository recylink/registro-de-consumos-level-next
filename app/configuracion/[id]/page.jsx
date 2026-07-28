import { notFound } from "next/navigation";
import { ConfigEdit } from "@/components/views/config-edit";
import { loadRecords, loadSucursales } from "@/lib/data";
import { emptyItems, ITEM_TYPES } from "@/lib/domain/sucursales";

export const metadata = { title: "Editar sucursal" };

// La sucursal a editar viene en la URL. En el prototipo era la vista
// "config-edit" leyendo un campo del estado global (configEditId), así que la
// pantalla no era enlazable y un refresh la perdía.
//
// El id "nueva" abre el formulario en blanco. La sucursal recién existe cuando
// se guarda: si el usuario cancela, no queda nada a medias en la planilla —
// misma intención que el draft `configNewSuc` del prototipo, pero sin estado
// global.

export default async function EditarSucursalPage({ params }) {
  const { id } = await params;
  const esNueva = id === "nueva";

  const [sucursales, records] = await Promise.all([loadSucursales(), loadRecords()]);
  const existente = sucursales.data.find((s) => s.id === id);
  if (!esNueva && !existente) notFound();

  const sucursal = existente || {
    // El id definitivo lo pone el cliente al guardar; acá solo importa que el
    // formulario tenga con qué trabajar.
    id: "nueva",
    nombre: "",
    direccion: "",
    activa: true,
    items: emptyItems(),
  };

  // Registros por tipo de esta sucursal: el diálogo de quitar subcategoría avisa
  // cuántos consumos ya existen.
  const registrosPorTipo = {};
  for (const t of ITEM_TYPES) registrosPorTipo[t] = 0;
  for (const r of records.data) {
    if (r.sucursal === sucursal.nombre && registrosPorTipo[r.type] != null) registrosPorTipo[r.type]++;
  }

  return (
    <ConfigEdit
      sucursal={sucursal}
      esNueva={esNueva}
      // Para validar el nombre duplicado sin incluir a la propia sucursal.
      nombresExistentes={sucursales.data.filter((s) => s.id !== id).map((s) => s.nombre.trim())}
      registrosPorTipo={registrosPorTipo}
    />
  );
}
