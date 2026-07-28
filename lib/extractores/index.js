import "server-only";

// Punto de entrada de la extracción: archivo + proveedor → filas para la tabla de
// revisión. Portado de rcExtract (proto/extractors.jsx).
//
// La sucursal nunca sale del documento: las boletas no la traen. Queda vacía y la
// completa la persona en la tabla de preview, o se resuelve por número de cliente
// contra la configuración.

import { textoDePdf } from "./texto-pdf";
import { rcParseIconstruye } from "./iconstruye";
import {
  rcExtraerAguas, rcExtraerAguasDelValle, rcExtraerCGE, rcExtraerChilquinta,
  rcExtraerEnel, rcExtraerEsval,
} from "./parsers";

// Proveedor → parser y tipo de consumo. El orden de las condiciones del
// prototipo se conserva como tabla explícita.
const POR_PROVEEDOR = {
  cge: { parser: rcExtraerCGE, type: "electricidad" },
  chilquinta: { parser: rcExtraerChilquinta, type: "electricidad" },
  enel: { parser: rcExtraerEnel, type: "electricidad" },
  "aguas-del-valle": { parser: rcExtraerAguasDelValle, type: "agua" },
  esval: { parser: rcExtraerEsval, type: "agua" },
  "aguas-andinas": { parser: rcExtraerAguas, type: "agua" },
};

function elegirParser(provider) {
  const directo = POR_PROVEEDOR[provider.id];
  if (directo) return directo;
  // Un proveedor eléctrico sin parser propio se lee con el de Enel, y uno de agua
  // con el de Aguas Andinas: los formatos son parecidos dentro del rubro.
  if (provider.type === "electricidad") return { parser: rcExtraerEnel, type: "electricidad" };
  if (provider.type === "agua") return { parser: rcExtraerAguas, type: "agua" };
  return null;
}

/** Sin datos clave la fila queda marcada para revisar antes de guardar. */
function estadoFila(datos) {
  if (!datos.fecha || !datos.numeroCliente) return "warn";
  return datos.consumo ? "ok" : "warn";
}

async function extraerPdf(file, provider) {
  const texto = await textoDePdf(await file.arrayBuffer());

  let elegido = elegirParser(provider);
  let datos;
  if (elegido) {
    datos = elegido.parser(texto);
  } else {
    // Proveedor genérico: se prueba el patrón eléctrico y, si no reconoce nada,
    // el de agua.
    datos = rcExtraerEnel(texto);
    if (datos.numeroCliente || datos.consumo) elegido = { type: "electricidad" };
    else {
      datos = rcExtraerAguas(texto);
      elegido = { type: "agua" };
    }
  }

  return [
    {
      date: datos.fecha || "",
      periodoInicio: datos.periodoInicio || "",
      periodoFin: datos.periodoFin || "",
      sucursal: "",
      type: elegido.type,
      subcat: null,
      provider: provider.name,
      cantidad: datos.consumo || "",
      costo: datos.costo || "",
      status: estadoFila(datos),
      numeroCliente: datos.numeroCliente || "",
      sourceFile: file.name,
    },
  ];
}

async function extraerExcel(file, provider) {
  // Petróleo o gas se decide por el nombre del proveedor o del archivo.
  const esGas = /gas/i.test(provider.name) || /gas/i.test(file.name);
  const tipoCombustible = esGas ? "Gas" : "Petróleo Diesel";

  const grupos = await rcParseIconstruye(file, tipoCombustible);
  if (!grupos.length) throw new Error("Sin filas válidas desde la fila 14");

  return grupos.map((g) => ({
    date: g.fecha,
    sucursal: "",
    type: "combustible",
    subcat: esGas ? "glp" : "diesel",
    provider: g.proveedor || provider.name,
    cantidad: g.cantidad,
    costo: g.costo,
    status: "ok",
    sourceFile: file.name,
  }));
}

/**
 * @param file      File recibido por FormData
 * @param provider  { id, name, type }
 */
export async function extraer(file, provider) {
  const ext = (file.name.toLowerCase().match(/\.([^.]+)$/) || [])[1];
  if (ext === "pdf") return extraerPdf(file, provider);
  if (ext === "xlsx" || ext === "xls") return extraerExcel(file, provider);
  throw new Error("Tipo de archivo no soportado");
}
