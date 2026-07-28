import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Metas de reducción" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Impacto ambiental"
      title="Metas de reducción"
      sub="Compromisos de empresa y por sucursal."
      origen="proto/metas.jsx"
    />
  );
}
