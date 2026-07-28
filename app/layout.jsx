import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";

export const metadata = {
  title: {
    default: "Registro de Consumos",
    template: "%s · Registro de Consumos",
  },
  description:
    "Registra consumos de electricidad, combustible y agua por sucursal y mide su impacto en emisiones GEI.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
