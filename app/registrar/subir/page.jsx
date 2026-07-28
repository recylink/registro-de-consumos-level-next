import { Pendiente } from "@/components/ui/pendiente";

export const metadata = { title: "Subir documento" };

export default function Page() {
  return (
    <Pendiente
      eyebrow="Registrar consumo"
      title="Subir documento"
      sub="Boletas y facturas de proveedor; los datos se extraen del documento."
      origen="proto/upload.jsx"
    />
  );
}
