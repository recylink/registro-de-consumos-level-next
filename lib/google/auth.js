import "server-only";
import { google } from "googleapis";
import {
  clientEmail,
  isSdkConfigured,
  privateKey,
  sdkFaltantes,
  spreadsheetId,
} from "../instance";

// Las credenciales se leen en lib/instance.js, que es el módulo que se ocupa del
// entorno, y se reexportan acá para quien las venía importando desde este archivo.
export { clientEmail, isSdkConfigured, privateKey, sdkFaltantes };

// Cliente del SDK de Google APIs con service account.
//
// Reemplaza al /exec del Apps Script, que era una aplicación web con acceso
// "cualquier usuario": un endpoint público que aceptaba escrituras de quien
// tuviera la URL. Acá la autorización es una clave privada que solo existe en el
// servidor, y los archivos de Drive pueden quedar privados.
//
// Las credenciales NO son un archivo JSON en el repo (acuerdo con TI, coworking
// del 2026-07-30): se leen de GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY.

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

export class SdkNotConfiguredError extends Error {
  constructor(faltan) {
    super(
      "SDK de Google no configurado: falta " +
        faltan.join(", ") +
        " en el entorno.",
    );
    this.name = "SdkNotConfiguredError";
  }
}

// El JWT se memoiza a nivel de módulo: googleapis renueva el access token solo,
// y con Fluid Compute la instancia se reusa entre requests, así que no hay un
// intercambio de token por llamada.
let cachedAuth = null;

export function googleAuth() {
  const faltan = sdkFaltantes();
  if (faltan.length) throw new SdkNotConfiguredError(faltan);
  if (!cachedAuth) {
    cachedAuth = new google.auth.JWT({
      email: clientEmail(),
      key: privateKey(),
      scopes: SCOPES,
    });
  }
  return cachedAuth;
}

let cachedSheets = null;
let cachedDrive = null;

export function sheetsApi() {
  if (!cachedSheets) {
    cachedSheets = google.sheets({ version: "v4", auth: googleAuth() });
  }
  return cachedSheets;
}

export function driveApi() {
  if (!cachedDrive) {
    cachedDrive = google.drive({ version: "v3", auth: googleAuth() });
  }
  return cachedDrive;
}

/**
 * Diagnóstico: confirma que la clave autentica Y que la service account tiene
 * acceso a la planilla. Son dos fallos distintos y se confunden fácil — una
 * clave válida sobre una planilla no compartida da 403, no 401. Devuelve además
 * los nombres de las hojas, que es lo que hace falta para verificar cada action
 * migrada contra la estructura real.
 */
export async function sdkPing() {
  const res = await sheetsApi().spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "properties.title,sheets.properties(title,sheetId,gridProperties)",
  });
  const sheets = (res.data.sheets || []).map((s) => ({
    nombre: s.properties.title,
    sheetId: s.properties.sheetId,
    filas: s.properties.gridProperties?.rowCount ?? null,
    columnas: s.properties.gridProperties?.columnCount ?? null,
  }));
  return {
    ok: true,
    titulo: res.data.properties?.title || null,
    clientEmail: clientEmail(),
    hojas: sheets,
  };
}
