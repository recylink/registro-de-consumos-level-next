"use server";

import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/apps-script";
import { run } from "@/lib/result";
import { deleteSucursal, upsertSucursal, writeSucursales } from "@/lib/sheets/sucursales";
import { writeEmissions } from "@/lib/sheets/emissions";
import { writeFotoNotifEmails } from "@/lib/sheets/config-store";

/**
 * Guarda una sola sucursal. Es la vía normal: no pisa lo que otra sesión haya
 * guardado sobre las demás sucursales.
 */
export async function saveSucursalAction(sucursal) {
  return run(async () => {
    await upsertSucursal(sucursal);
    revalidateTag(TAGS.sucursales);
    return {};
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
