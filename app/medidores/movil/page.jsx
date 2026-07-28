import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Registro móvil" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Medidores"
      title="Registro móvil"
      sub="Toma de lecturas en terreno."
      origen="proto/medidores.jsx"
    />
  );
}
