import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Consumos registrados" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Dashboard"
      title="Consumos registrados"
      sub="KPIs, evolución mensual y tabla editable de registros."
      origen="proto/dashboard.jsx"
    />
  );
}
