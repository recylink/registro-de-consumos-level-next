import "server-only";

// Texto de un PDF, agrupado en líneas visuales. Portado de rcPdfText
// (proto/extractors.jsx).
//
// Cambio de fondo: en el prototipo esto corría en el navegador con pdf.js traído
// por CDN y un worker remoto. Acá corre en el servidor con pdfjs-dist de npm, lo
// que evita mandar ~1 MB de librería al navegador, saca la dependencia de un CDN
// ajeno del camino crítico, y deja el parsing donde el resultado se va a usar.
//
// Se usa la build `legacy` porque es la que funciona en Node sin canvas ni DOM.

const TOL_Y = 2.5;

/**
 * pdf.mjs evalúa `new DOMMatrix()` a nivel de módulo. En el navegador existe; en
 * Node, pdfjs intenta sacarlo de @napi-rs/canvas, que es una dependencia
 * *opcional* con binario por plataforma: en el runtime del deploy no está, y el
 * import moría con "ReferenceError: DOMMatrix is not defined" antes de leer una
 * sola página.
 *
 * Instalar @napi-rs/canvas sería traer un binario nativo de decenas de MB para
 * algo que no usamos: extraer texto no toca el canvas ni las matrices. Basta un
 * stub inerte que satisfaga la construcción del módulo. Si el runtime sí trae un
 * DOMMatrix de verdad (o el paquete está instalado), este stub no se aplica.
 */
function stubDOMMatrix() {
  if (typeof globalThis.DOMMatrix !== "undefined") return;
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      const m = Array.isArray(init) && init.length === 6 ? init : [1, 0, 0, 1, 0, 0];
      [this.a, this.b, this.c, this.d, this.e, this.f] = m;
    }
    // Las rutas de render que sí las usan no corren al extraer texto; devolver
    // `this` mantiene el encadenamiento sin fingir una transformación.
    translate() { return this; }
    scale() { return this; }
    invertSelf() { return this; }
    multiplySelf() { return this; }
    preMultiplySelf() { return this; }
  };
}

// Import diferido: pdfjs es grande y solo se necesita cuando llega un PDF.
async function pdfjs() {
  stubDOMMatrix();
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/**
 * @returns { flat, lined, combined } — el mismo trío que esperan los parsers:
 *   flat     todo en una línea, espacios colapsados
 *   lined    una línea por fila visual del documento
 *   combined flat + "\n" + lined
 */
export async function textoDePdf(buffer) {
  const { getDocument } = await pdfjs();
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    // Sin worker aparte: en el servidor no hay ventaja y evita resolver el
    // archivo del worker dentro del bundle.
    disableWorker: true,
    isEvalSupported: false,
  }).promise;

  // Hasta 2 páginas: los datos relevantes están en la primera, pero en boletas
  // largas la línea de costo a veces cae en la segunda.
  const items = [];
  for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    items.push(...content.items);
  }

  // Agrupa por coordenada Y para reconstruir filas visuales, como hace
  // extract_text de pdfplumber. transform = [scaleX, skewX, skewY, scaleY, x, y].
  const lines = [];
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]);
    let bucket = lines.find((l) => Math.abs(l.y - y) <= TOL_Y);
    if (!bucket) {
      bucket = { y, items: [] };
      lines.push(bucket);
    }
    bucket.items.push(it);
  }
  lines.sort((a, b) => b.y - a.y); // de arriba hacia abajo
  for (const l of lines) l.items.sort((a, b) => a.transform[4] - b.transform[4]); // izq → der

  const lined = lines.map((l) => l.items.map((i) => i.str).join(" ")).join("\n");
  const flat = lined.replace(/\s+/g, " ").trim();
  return { flat, lined, combined: flat + "\n" + lined };
}
