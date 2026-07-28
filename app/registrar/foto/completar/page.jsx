import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Completar registros" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Tomar foto"
      title="Completar registros"
      sub="Cola de fotos pendientes de completar."
      origen="proto/foto.jsx"
    />
  );
}
