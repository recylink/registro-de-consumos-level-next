import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Sucursales" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Configuración"
      title="Sucursales"
      sub="Sucursales configuradas y sus tipos de consumo."
      origen="proto/config.jsx"
    />
  );
}
