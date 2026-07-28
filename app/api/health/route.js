import { NextResponse } from "next/server";
import { ping } from "@/lib/apps-script";
import { instanceInfo } from "@/lib/data";

// Diagnóstico de la instancia: si el endpoint está configurado y qué versión del
// Apps Script corre detrás. Reemplaza al `curl ...?action=ping` a mano, que
// ahora no se puede hacer desde afuera porque la URL del /exec no es pública.
//
//   curl -s http://localhost:3000/api/health
//
// No expone la URL del endpoint, solo si está presente.

export const dynamic = "force-dynamic";

export async function GET() {
  const info = instanceInfo();
  if (!info.configured) {
    return NextResponse.json(
      { ...info, backend: null, error: "APPS_SCRIPT_URL no configurada (modo local)" },
      { status: 200 },
    );
  }
  try {
    const backend = await ping();
    return NextResponse.json({ ...info, backend });
  } catch (err) {
    return NextResponse.json({ ...info, backend: null, error: err.message }, { status: 502 });
  }
}
