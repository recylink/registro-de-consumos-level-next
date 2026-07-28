import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Tomar foto" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Registrar consumo"
      title="Tomar foto"
      sub="Captura ahora, completa los datos después."
      origen="proto/foto.jsx"
    />
  );
}
