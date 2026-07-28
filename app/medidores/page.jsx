import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Lecturas de medidores" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Medidores"
      title="Lecturas de medidores"
      sub="Lecturas físicas por medidor, consumo y costo."
      origen="proto/medidores.jsx"
    />
  );
}
