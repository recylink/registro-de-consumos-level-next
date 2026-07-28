import "./globals.css";

export const metadata = {
  title: "Registro de Consumos",
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
      <body>{children}</body>
    </html>
  );
}
