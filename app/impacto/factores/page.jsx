import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Factores de emisión" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Impacto ambiental"
      title="Factores de emisión"
      sub="Valores por energético, con overrides por sucursal."
      origen="proto/factores.jsx"
    />
  );
}
