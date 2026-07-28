"use server";

import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/apps-script";
import { run } from "@/lib/result";
import { deleteSucursal, upsertSucursal, writeSucursales } from "@/lib/sheets/sucursales";
import { writeEmissions } from "@/lib/sheets/emissions";
import { writeFotoNotifEmails } from "@/lib/sheets/config-store";
import { renameSucursalInRecords } from "@/lib/sheets/records";

/**
 * Guarda una sola sucursal. Es la vía normal: no pisa lo que otra sesión haya
 * guardado sobre las demás sucursales.
 *
 * `renombrarDesde` (opcional) es el nombre anterior: si viene, los registros
 * históricos de esa sucursal quedan con el nombre nuevo. Se hace ANTES del
 * upsert, para que un fallo a mitad de camino deje la configuración vieja
 * coherente con las filas viejas.
 */
export async function saveSucursalAction(sucursal, { renombrarDesde } = {}) {
  return run(async () => {
    let renombrados = 0;
    if (renombrarDesde && renombrarDesde !== sucursal.nombre) {
      renombrados = await renameSucursalInRecords(renombrarDesde, sucursal.nombre);
    }
    await upsertSucursal(sucursal);
    revalidateTag(TAGS.sucursales);
    if (renombrados) revalidateTag(TAGS.records);
    return { renombrados };
  });
}

/**
 * Guarda varias sucursales de una vez: el wizard de puesta en marcha define un
 * conjunto completo. Es aditivo (upsert por id, una por una), no un reemplazo:
 * si ya había sucursales configuradas, no se pierden.
 *
 * Secuencial a propósito — el Apps Script serializa las mutaciones con un lock,
 * así que mandarlas en paralelo solo agrega espera.
 */
export async function saveSucursalesAction(sucursales) {
  return run(async () => {
    let guardadas = 0;
    for (const suc of sucursales || []) {
      await upsertSucursal(suc);
      guardadas++;
    }
    revalidateTag(TAGS.sucursales);
    return { guardadas };
  });
}

export async function deleteSucursalAction(id) {
  return run(async () => {
    await deleteSucursal(id);
    revalidateTag(TAGS.sucursales);
    return {};
  });
}

/**
 * Reescribe la tabla completa de sucursales. Reservado para el onboarding, que
 * define el conjunto inicial de una vez.
 */
export async function replaceSucursalesAction(sucursales) {
  return run(async () => {
    await writeSucursales(sucursales);
    revalidateTag(TAGS.sucursales);
    return {};
  });
}

/** Factores de emisión, overrides por sucursal, refrigerantes y metas. */
export async function saveEmissionsAction(emissions) {
  return run(async () => {
    await writeEmissions(emissions);
    revalidateTag(TAGS.emissions);
    return {};
  });
}

export async function saveFotoNotifEmailsAction(emails) {
  return run(async () => {
    await writeFotoNotifEmails(emails);
    revalidateTag(TAGS.config);
    return {};
  });
}
