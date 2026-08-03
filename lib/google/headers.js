import "server-only";
import { SHEETS } from "../instance";

// Encabezados por hoja. Los usa `append` cuando la hoja destino no existe: el
// Apps Script la creaba con su encabezado antes de escribir (apps-script.gs:232).
//
// Es una copia de WEB_CFG.HEADERS de apps-script.gs, y por ahora la verdad está
// duplicada en dos lugares. Se acepta a propósito mientras dure la migración:
// mientras haya actions saliendo por el /exec, el .gs tiene que seguir sabiendo
// crear sus hojas. Al apagar la última action, el .gs se archiva en appscripts/
// y esta tabla queda como única dueña.
//
// Si se toca una de las dos, tocar la otra. Un desajuste solo se nota cuando una
// hoja se crea de cero, que es raro y por eso pasa desapercibido.

export const ENCABEZADOS = {
  [SHEETS.COMBUSTIBLE]: [
    "Link", "Fecha", "Consumo", "Costo", "Empresa", "Sucursal", "Tipo",
    "Proveedor", "Estado", "Origen",
  ],
  [SHEETS.ELECTRICIDAD]: [
    "Link PDF", "Número de cliente", "Fecha", "Consumo total", "Costo ($)",
    "Empresa", "Sucursal", "Tipo de consumo", "Proveedor", "Estado", "Origen",
  ],
  [SHEETS.AGUA]: [
    "Link PDF", "Número de cliente", "Fecha emisión", "Consumo total", "Costo ($)",
    "Empresa", "Sucursal", "Tipo de consumo", "Proveedor", "Subcategoría",
    "Estado", "Origen",
  ],
  "N° de cliente": [
    "Número de cliente", "Empresa", "Sucursal", "Tipo de consumo", "Proveedor",
  ],
  "Fill out": [
    "Submission ID", "Submission time", "Nombre Usuario", "Nombre sucursal",
    "Mes de registro", "N° trabajadores", "N° trabajadoras", "m2 totales",
    "% Avance", "URL Excel Petróleo", "URL Excel Gas", "Procesado",
  ],
  [SHEETS.FOTOS]: [
    "File ID", "Drive URL", "Fecha subida", "Tipo", "Sucursal", "Subcategoría",
    "Período", "Status", "Fecha completado", "Consumo", "Unidad", "Costo",
    "Proveedor", "Notas",
  ],
  [SHEETS.MED_MEDIDORES]: [
    "ID", "Sucursal", "Tipo", "Nombre", "Número", "Activo", "Facturable",
  ],
  [SHEETS.MED_LECTURAS]: [
    "ID", "Medidor ID", "Período", "Lectura", "Factura Link", "Factura Nombre",
    "Factura File ID", "Pago Link", "Pago Nombre", "Pago File ID",
    "Respaldo Link", "Respaldo Nombre", "Respaldo File ID",
  ],
  [SHEETS.MED_PRECIOS]: ["Sucursal", "Tipo", "Período", "Precio"],
};

// Estas dos las creaban funciones aparte del .gs (setConfigSucursales,
// setEmissions) y no estaban en WEB_CFG.HEADERS.
export const ENCABEZADOS_CONFIG_SUCURSALES = [
  "Sucursal ID", "Nombre", "Dirección", "Activa", "Tipo consumo", "Subcat ID",
  "Sistema eléctrico", "Tipo", "Tipo (otro)", "Uso", "Unidad",
  "Proveedor", "Proveedor (otro)", "N° cliente",
];

export const ENCABEZADOS_EMISIONES = [
  "Scope", "Sucursal ID", "Key", "Value", "Pending Review", "Refrig Tipo", "Refrig Mes",
];

export const ENCABEZADOS_CONFIG = ["key", "value"];
