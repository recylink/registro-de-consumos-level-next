// Catálogo de proveedores con extractor. Portado de PROVIDER_TEMPLATES
// (proto/upload.jsx).
//
// `hasExtractor` distingue los que tienen parser propio de los que están en el
// catálogo pero todavía no se pueden leer automáticamente.

export const PROVEEDORES_DOC = [
  { id: "enel",            name: "Enel",                type: "electricidad", initials: "E",  examples: "PDF mensual",                 hasExtractor: true },
  { id: "cge",             name: "CGE",                 type: "electricidad", initials: "C",  examples: "PDF mensual",                 hasExtractor: true },
  { id: "chilquinta",      name: "Chilquinta",          type: "electricidad", initials: "CH", examples: "PDF mensual",                 hasExtractor: true },
  { id: "aguas-andinas",   name: "Aguas Andinas",       type: "agua",         initials: "AA", examples: "PDF mensual · Excel detalle", hasExtractor: true },
  { id: "aguas-del-valle", name: "Aguas del Valle",     type: "agua",         initials: "AV", examples: "PDF mensual",                 hasExtractor: true },
  { id: "esval",           name: "Esval",               type: "agua",         initials: "E",  examples: "PDF mensual",                 hasExtractor: true },
  { id: "iconstruye-pet",  name: "Iconstruye Petróleo", type: "combustible",  initials: "IP", examples: "Excel consolidado",           hasExtractor: true },
  { id: "copec",           name: "Copec",               type: "combustible",  initials: "C",  examples: "PDF · Excel",                 hasExtractor: false, hidden: true },
  { id: "shell",           name: "Shell",               type: "combustible",  initials: "S",  examples: "PDF mensual",                 hasExtractor: false, hidden: true },
  { id: "generic",         name: "Otro proveedor",      type: "any",          initials: "?",  examples: "Lo intentamos extraer; algunos campos pueden quedar vacíos", hasExtractor: false, hidden: true },
];

/**
 * ¿Alguna sucursal activa tiene configurado este proveedor para el tipo que
 * corresponde? Match exacto sin distinguir mayúsculas; los proveedores escritos
 * a mano ("__otro") no cuentan, porque el nombre libre no identifica el formato
 * de la boleta.
 */
export function proveedorConfigurado(sucursales, proveedor) {
  const buscado = String(proveedor.name || "").trim().toLowerCase();
  if (!buscado) return false;
  for (const suc of sucursales || []) {
    if (!suc.activa) continue;
    const item = suc.items?.[proveedor.type];
    if (!item?.activo) continue;
    for (const sc of item.subcats || []) {
      if (!sc || sc.proveedor === "__otro") continue;
      if (String(sc.proveedor || "").trim().toLowerCase() === buscado) return true;
    }
  }
  return false;
}

/**
 * Proveedores que se ofrecen en el paso 1: los que tienen extractor Y están
 * configurados en alguna sucursal activa. Subir una boleta de un proveedor sin
 * configurar no serviría: no habría a qué sucursal atribuirla.
 */
export function proveedoresDisponibles(sucursales) {
  return PROVEEDORES_DOC.filter((p) => !p.hidden && p.hasExtractor).filter((p) =>
    proveedorConfigurado(sucursales, p),
  );
}
