import "server-only";
import { apiGet, apiPost, TAGS } from "../apps-script";

// Configuración de sucursales ↔ hoja "Config Sucursales".
// Tabla relacional: una fila por subcategoría, una columna por propiedad. La
// app aplana al guardar y reconstruye el árbol al leer.
//
// Columnas (ver CONFIG_SUC_HEADERS en apps-script.gs):
//   0 Sucursal ID | 1 Nombre | 2 Dirección | 3 Activa | 4 Tipo consumo
//   5 Subcat ID   | 6 Sistema eléctrico | 7 Tipo | 8 Tipo (otro) | 9 Uso
//  10 Unidad      | 11 Proveedor | 12 Proveedor (otro) | 13 N° cliente

const ITEM_TYPES = ["electricidad", "combustible", "agua", "refrigerantes"];

function emptyItems() {
  return {
    electricidad: { activo: false, subcats: [] },
    combustible: { activo: false, subcats: [] },
    agua: { activo: false, subcats: [] },
    refrigerantes: { activo: false, subcats: [] },
  };
}

export function flatten(sucursales) {
  const rows = [];
  for (const suc of sucursales || []) {
    const base = [suc.id, suc.nombre, suc.direccion || "", suc.activa ? "Sí" : "No"];
    let pushed = false;
    for (const type of ITEM_TYPES) {
      const item = suc.items && suc.items[type];
      if (!item || !item.activo) continue;
      for (const sc of item.subcats || []) {
        rows.push([
          ...base,
          type,
          sc.id || "",
          sc.sistemaElectrico || "",
          sc.tipo || "",
          sc.tipoCustom || "",
          sc.uso || "",
          sc.unidad || "",
          sc.proveedor || "",
          sc.proveedorCustom || "",
          sc.numCliente || "",
        ]);
        pushed = true;
      }
    }
    // Sucursal sin subcategorías activas: fila base para que persista igual.
    if (!pushed) rows.push([...base, "", "", "", "", "", "", "", "", "", ""]);
  }
  return rows;
}

export function unflatten(rows) {
  const byId = new Map();
  const order = [];
  for (const r of rows || []) {
    const sucId = r[0];
    if (!sucId) continue;
    if (!byId.has(sucId)) {
      byId.set(sucId, {
        id: sucId,
        nombre: r[1] || "",
        direccion: r[2] || "",
        // Solo un "No" explícito la desactiva; vacío se lee como activa.
        activa: String(r[3]).trim().toLowerCase() !== "no",
        items: emptyItems(),
      });
      order.push(sucId);
    }
    const type = r[4];
    if (!type) continue; // fila base, sin subcategoría
    const item = byId.get(sucId).items[type];
    if (!item) continue;
    item.activo = true;
    const sc = { id: r[5] || "sc" + item.subcats.length };
    if (r[6]) sc.sistemaElectrico = r[6];
    if (r[7]) sc.tipo = r[7];
    if (r[8]) sc.tipoCustom = r[8];
    if (r[9]) sc.uso = r[9];
    if (r[10]) sc.unidad = r[10];
    if (r[11]) sc.proveedor = r[11];
    if (r[12]) sc.proveedorCustom = r[12];
    if (r[13]) sc.numCliente = r[13];
    item.subcats.push(sc);
  }
  return order.map((id) => byId.get(id));
}

export async function readSucursales() {
  const data = await apiGet(
    { action: "getConfigSucursales" },
    { tag: TAGS.sucursales, revalidate: 60 },
  );
  return unflatten((data && data.rows) || []);
}

/**
 * Guarda un conjunto de sucursales, una por una y cada una por su ID.
 *
 * Antes esto era `setConfigSucursales`: un `clear()` + reescribir la hoja completa.
 * Solo lo usaba el onboarding, que define el conjunto inicial "de una vez", y con ese
 * argumento parecía inofensivo. Pero el argumento vale para el primer onboarding, no
 * para el código: nada impide re-correrlo sobre una instancia que ya tiene datos, y
 * ahí borraba todas las sucursales que no vinieran en la lista — incluidas las que
 * hubiera creado otra sesión mientras el wizard estaba abierto.
 *
 * En upserts por ID el peor caso es que queden sucursales viejas de más, visibles y
 * borrables. Nunca una que desapareció.
 *
 * Secuencial y no en paralelo: cada `upsertSucursal` lee la hoja para encontrar las
 * filas de su id, y en paralelo se leerían entre sí a medio escribir.
 *
 * Con esto `reemplazarHoja` queda sin ningún llamador en la app. El invariante que
 * habilita es lo que importa más que el cambio: NINGÚN camino de la app reescribe una
 * hoja completa. Es una regla que se puede revisar en un diff, en vez de una propiedad
 * que hay que acordarse de mantener.
 */
export async function writeSucursales(sucursales) {
  for (const suc of sucursales || []) {
    await upsertSucursal(suc);
  }
  return (sucursales || []).length;
}

/** Inserta o actualiza una sola sucursal por ID, sin tocar las demás. */
export async function upsertSucursal(suc) {
  if (!suc || !suc.id) throw new Error("Sucursal sin id");
  await apiPost({ action: "upsertSucursal", id: suc.id, rows: flatten([suc]) });
}

export async function deleteSucursal(id) {
  if (!id) throw new Error("Falta el id de la sucursal");
  await apiPost({ action: "deleteSucursal", id });
}
