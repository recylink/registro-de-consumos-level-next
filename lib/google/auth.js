import "server-only";
import { google } from "googleapis";
import { spreadsheetId } from "../instance";

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

export function clientEmail() {
  return String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
}

/**
 * La clave privada viaja en una env var de una sola línea, con los saltos como
 * `\n` literales — es como la guardan tanto dotenv como el panel de Vercel. Sin
 * deshacer ese escape, googleapis falla al parsear el PEM con un
 * `error:1E08010C:DECODER routines::unsupported` que no menciona la causa.
 */
export function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
}

/** Qué falta para poder usar el SDK. Vacío = configurado. */
export function sdkFaltantes() {
  const faltan = [];
  if (!clientEmail()) faltan.push("GOOGLE_CLIENT_EMAIL");
  if (!privateKey()) faltan.push("GOOGLE_PRIVATE_KEY");
  if (!spreadsheetId()) faltan.push("SPREADSHEET_ID");
  return faltan;
}

export function isSdkConfigured() {
  return sdkFaltantes().length === 0;
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
