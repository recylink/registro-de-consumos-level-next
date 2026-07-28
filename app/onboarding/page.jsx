import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Configura tu empresa" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Puesta en marcha"
      title="Configura tu empresa"
      sub="Sucursales, tipos de consumo y proveedores en tres pasos."
      origen="proto/onboarding.jsx"
    />
  );
}
