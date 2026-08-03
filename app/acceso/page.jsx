import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_ACCESO, muroActivo, tokenValido } from "@/lib/auth/acceso";
import { FormAcceso } from "@/components/views/acceso";

// Pantalla de ingreso. La protección real la aplica `proxy.js` antes de renderizar
// cualquier ruta; esta pantalla solo recibe la contraseña.
//
// Se dibuja sin el chrome de la app (ver SIN_CHROME en components/shell/app-shell.jsx).

export const metadata = { title: "Acceso" };
export const dynamic = "force-dynamic";

export default async function AccesoPage({ searchParams }) {
  const params = await searchParams;
  const volver = typeof params?.volver === "string" ? params.volver : "/";

  // Solo rutas internas: un `volver` con host propio convertiría esta pantalla en
  // un trampolín para mandar gente a otro sitio desde nuestro dominio.
  const destino = volver.startsWith("/") && !volver.startsWith("//") ? volver : "/";

  // Sin muro no hay nada que pedir; y si ya entró, no tiene sentido mostrar el
  // formulario otra vez.
  if (!muroActivo()) redirect(destino);
  const token = (await cookies()).get(COOKIE_ACCESO)?.value;
  if (await tokenValido(token)) redirect(destino);

  return <FormAcceso destino={destino} />;
}
