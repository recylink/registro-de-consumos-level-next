import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Huella de emisiones GEI" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Impacto ambiental"
      title="Huella de emisiones GEI"
      sub="Emisiones por alcance, sucursal y período."
      origen="proto/impacto.jsx"
    />
  );
}
