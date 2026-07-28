import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Editar sucursal" };

// La edición de sucursal era la vista "config-edit", que sacaba qué sucursal
// editar de un campo del estado global. Acá el id está en la URL, así que la
// pantalla es enlazable y sobrevive a un refresh.

export default async function Page({ params }) {
  const { id } = await params;
  return (
    <Pendiente
      eyebrow="Configuración"
      title="Editar sucursal"
      sub={`Tipos de consumo, subcategorías y proveedores de la sucursal ${id}.`}
      origen="proto/config-edit.jsx"
    />
  );
}
