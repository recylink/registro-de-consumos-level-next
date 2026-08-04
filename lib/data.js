import "server-only";
import { EMPRESA, hayBackend, spreadsheetUrl } from "./instance";
import { readRecords } from "./sheets/records";
import { readSucursales } from "./sheets/sucursales";
import { readEmissions } from "./sheets/emissions";
import { readMedidores } from "./sheets/medidores";
import { readFotos } from "./sheets/fotos";
import { readFotoNotifEmails } from "./sheets/config-store";

// Fachada de lectura para componentes de servidor. Cada loader devuelve
// { data, error }: sin backend configurado o con el Apps Script caído, la
// pantalla se dibuja con datos vacíos y un aviso, en vez de tirar la ruta
// entera a la pantalla de error.
//
// Los módulos de lib/sheets/ sí lanzan — quien necesite el fallo duro (un
// Server Action, por ejemplo) los usa directo.

async function load(fallback, fn) {
  if (!hayBackend()) {
    return { data: fallback, error: null, configured: false };
  }
  try {
    return { data: await fn(), error: null, configured: true };
  } catch (err) {
    console.error("[rc:data]", err);
    return { data: fallback, error: err.message, configured: true };
  }
}

export const loadRecords = () => load([], readRecords);
export const loadSucursales = () => load([], readSucursales);
export const loadEmissions = () => load(null, readEmissions);
export const loadMedidores = () =>
  load({ meters: [], readings: [], prices: [], docs: {} }, readMedidores);
export const loadFotos = () => load([], readFotos);
export const loadFotoNotifEmails = () => load([], readFotoNotifEmails);

/** Datos de la instancia para el chrome de la app (link a la planilla, avisos). */
export function instanceInfo() {
  return {
    empresa: EMPRESA,
    configured: hayBackend(),
    spreadsheetUrl: spreadsheetUrl(),
  };
}
