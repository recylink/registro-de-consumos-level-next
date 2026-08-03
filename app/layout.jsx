import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { muroActivo } from "@/lib/auth/acceso";

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
  // Si el sitio está tras contraseña, el sidebar muestra el botón de salir. El
  // dato baja desde acá porque `muroActivo()` lee una env var del servidor y el
  // shell es un componente cliente.
  return (
    <html lang="es">
      <body>
        <AppShell conMuro={muroActivo()}>{children}</AppShell>
      </body>
    </html>
  );
}
