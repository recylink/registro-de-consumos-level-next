import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/apps-script";
import { invalidarHojas } from "@/lib/google/sheets-api";

// Invalida todas las etiquetas de caché de lectura, para poder medir el costo EN
// FRÍO de renderizar la app.
//
//   curl -s -X POST http://localhost:3000/api/migracion/invalidar
//
// Hace falta porque el número que importa no es cuántas llamadas hace la app con
// caché caliente (cero), sino cuántas hace cuando la caché expira: la cuota de la
// API de Sheets es de 60 lecturas por minuto y por usuario, y prerenderizar las
// 18 páginas del build la reventó.
//
// Solo en desarrollo.

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
  }
  const etiquetas = Object.values(TAGS);
  for (const t of etiquetas) revalidateTag(t);
  invalidarHojas();
  return NextResponse.json({ ok: true, invalidadas: etiquetas });
}
