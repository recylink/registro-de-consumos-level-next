import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Estado de carga por sucursal" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Matriz de carga"
      title="Estado de carga por sucursal"
      sub="Qué falta cargar, por sucursal, tipo y mes."
      origen="proto/upload-matrix.jsx"
    />
  );
}
