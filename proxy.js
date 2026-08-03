import { NextResponse } from "next/server";
import { COOKIE_ACCESO, muroActivo, tokenValido } from "@/lib/auth/acceso";

// Muro de contraseña, aplicado antes de que se renderice cualquier pantalla.
//
// Se llama `proxy.js` y no `middleware.js` porque en Next 16 la convención
// `middleware` está deprecada; con los dos archivos presentes el build falla.
//
// Sin `SITE_PASSWORD` configurada esto no hace nada y la app queda abierta: así el
// desarrollo local y los deploys actuales siguen funcionando igual, y el muro se
// enciende poniendo la variable.

const PUBLICAS = [
  "/acceso", // la propia pantalla de ingreso, o el redirect sería infinito
  "/_next", // JS, CSS y demás estáticos del build
  "/api/version", // solo devuelve el id del deploy; lo consulta el aviso de versión nueva
  "/favicon.ico",
  "/icon.svg",
  "/fonts",
];

// `/api/health` NO está en la lista a propósito: expone la URL de la planilla.

function esPublica(pathname) {
  return PUBLICAS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(request) {
  if (!muroActivo()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (esPublica(pathname)) return NextResponse.next();

  const token = request.cookies.get(COOKIE_ACCESO)?.value;
  if (await tokenValido(token)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/acceso";
  // Para volver a donde iba después de entrar. Solo la ruta relativa: un destino
  // con host abierto sería un redirect a sitios ajenos desde nuestro dominio.
  url.search = pathname !== "/" ? `?volver=${encodeURIComponent(pathname + search)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Todo menos los estáticos. El chequeo fino queda en `esPublica`, que también
  // corre para las rutas que sí pasan por acá.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
