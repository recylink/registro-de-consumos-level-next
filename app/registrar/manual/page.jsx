import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Registro manual" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Registrar consumo"
      title="Registro manual"
      sub="Un consumo a la vez con un formulario corto."
      origen="proto/manual.jsx"
    />
  );
}
