import { NextResponse } from "next/server";
import { ping } from "@/lib/apps-script";
import { instanceInfo } from "@/lib/data";
import { isSdkConfigured, sdkFaltantes, sdkPing } from "@/lib/google/auth";
import { estadoFlag } from "@/lib/backend-flag";
import { appsScriptConfigurado } from "@/lib/instance";

// Diagnóstico de la instancia. Durante la migración de Apps Script al SDK de
// Google APIs conviven dos backends, así que reporta los dos por separado: cuál
// está configurado y cuál responde de verdad.
//
//   curl -s http://localhost:3000/api/health
//
// No expone la URL del /exec ni la clave privada, solo si están presentes.

export const dynamic = "force-dynamic";

async function probar(fn) {
  try {
    return { ok: true, detalle: await fn() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function GET() {
  const info = instanceInfo();

  // `info.configured` ahora significa "hay algún backend", así que no sirve para
  // decidir si sondear el viejo: con solo el SDK daría true y el sondeo fallaría.
  const appsScript = appsScriptConfigurado()
    ? await probar(ping)
    : { ok: false, error: "APPS_SCRIPT_URL no configurada" };

  const sdk = isSdkConfigured()
    ? await probar(sdkPing)
    : { ok: false, error: "falta " + sdkFaltantes().join(", ") };

  // 502 solo si NINGÚN backend responde: durante la migración basta con que uno
  // sirva para que la app siga en pie.
  const status = appsScript.ok || sdk.ok ? 200 : 502;

  return NextResponse.json(
    { ...info, migracion: estadoFlag(), appsScript, sdk },
    { status },
  );
}
