import "server-only";
import { sdkActionsImplementadas, sdkImplementa } from "./google/actions";
import { isSdkConfigured, sdkFaltantes } from "./google/auth";

// Qué action va por el SDK de Google y qué action sigue yendo al /exec del Apps
// Script. Existe para que la migración sea de a una y reversible sin tocar código:
// las dos rutas escriben la MISMA planilla, así que conviven sin conflicto.
//
//   RC_SDK_ACTIONS=                       todo por Apps Script (default)
//   RC_SDK_ACTIONS=read,getFotos          esas dos por el SDK
//   RC_SDK_ACTIONS=*                      todas las implementadas
//
// En Vercel es una env var: cambiarla y redeployar revierte una action sin
// revertir un commit.

export function accionesHabilitadas() {
  return String(process.env.RC_SDK_ACTIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export class SdkHabilitadoSinCredencialesError extends Error {
  constructor(action) {
    super(
      `RC_SDK_ACTIONS incluye "${action}" pero el SDK no está configurado: ` +
        `falta ${sdkFaltantes().join(", ")}.`,
    );
    this.name = "SdkHabilitadoSinCredencialesError";
  }
}

/**
 * ¿Esta action va por el SDK?
 *
 * Si está habilitada pero faltan credenciales, LANZA en vez de caer al Apps
 * Script. El fallback silencioso sería tentador —los dos backends escriben la
 * misma planilla, la app seguiría en pie— pero dejaría un deploy mal configurado
 * funcionando en apariencia, y la migración se daría por hecha sin haber ocurrido.
 * El fallo se ve en /api/health antes de llegar a producción.
 */
export function usarSdk(action) {
  const habilitadas = accionesHabilitadas();
  const pedida =
    habilitadas.includes("*") ? sdkImplementa(action) : habilitadas.includes(action);
  if (!pedida) return false;
  if (!sdkImplementa(action)) return false; // habilitada pero aún sin implementar
  if (!isSdkConfigured()) throw new SdkHabilitadoSinCredencialesError(action);
  return true;
}

/** Estado del flag, para /api/health. */
export function estadoFlag() {
  const habilitadas = accionesHabilitadas();
  const implementadas = sdkActionsImplementadas();
  const todas = habilitadas.includes("*");
  return {
    RC_SDK_ACTIONS: habilitadas.length ? habilitadas.join(",") : "(vacío)",
    implementadas,
    porSdk: todas ? implementadas : habilitadas.filter((a) => implementadas.includes(a)),
    // Pedidas pero sin implementación: casi siempre un nombre mal escrito, y
    // silenciosamente seguirían saliendo por Apps Script.
    desconocidas: todas ? [] : habilitadas.filter((a) => !implementadas.includes(a)),
  };
}
