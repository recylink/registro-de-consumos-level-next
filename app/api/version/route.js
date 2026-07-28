import { NextResponse } from "next/server";

// Identidad del deploy que está sirviendo. El cliente la consulta cada tanto
// (components/shell/version-banner.jsx) y avisa si cambió: una pestaña abierta
// hace horas contra un deploy viejo puede llamar a Server Actions que ya no
// existen.
//
// Reemplaza al `version.json` que el prototipo generaba con un workflow de
// GitHub Actions; en Vercel el identificador ya viene en el entorno.

export const dynamic = "force-dynamic";

export function GET() {
  const version =
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "dev";
  return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
}
