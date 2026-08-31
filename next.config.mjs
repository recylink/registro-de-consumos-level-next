import { BODY_SIZE_LIMIT } from "./lib/domain/archivos.js";

// En desarrollo el bundler usa `eval` para el hot reload y un WebSocket para
// avisar de los cambios. Sin estas dos excepciones, `npm run dev` queda con la
// pantalla en blanco y el error solo aparece en la consola del navegador.
const DEV = process.env.NODE_ENV !== "production";

/**
 * CSP de la aplicación. Acota de dónde puede salir cada cosa que el navegador
 * carga y, sobre todo, a dónde puede mandar datos.
 *
 * `'unsafe-inline'` en scripts es el precio de no implementar nonces por
 * request: Next inyecta scripts inline para la hidratación y el runtime del App
 * Router. Endurecerlo requiere generar un nonce en proxy.js y propagarlo, que es
 * un cambio bastante mayor que este archivo.
 */
// Quién puede meter la app dentro de un iframe. Vacío = nadie, que es el default y
// lo que corresponde salvo que se embeba a propósito.
//
// Va en una env var y no fijo acá porque el sitio que embebe cambia por cliente: es
// configuración de la instancia, como SPREADSHEET_ID. Con la variable vacía, el
// comportamiento es idéntico al de antes.
//
// Se escribe como origen completo, CON esquema: `https://www.recylink.com`. Sin el
// `https://` el navegador descarta la regla entera y sigue bloqueando, sin decir por
// qué. Y es el origen del sitio que CONTIENE el iframe, no el de esta app.
const EMBEBIBLE_EN = String(process.env.FRAME_ANCESTORS || "").trim();
const FRAME_ANCESTORS = EMBEBIBLE_EN || "'none'";

const CSP_APP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'", // los componentes usan style={{…}}
  // `data:`/`blob:` son las vistas previas locales antes de subir; drive.google.com
  // son las miniaturas de los respaldos (components/medidores/celdas.jsx).
  "img-src 'self' data: blob: https://drive.google.com https://*.googleusercontent.com",
  // Next arma algunos workers desde un blob; sin esto caerían en default-src.
  "worker-src 'self' blob:",
  "font-src 'self' data:", // las tipografías se sirven desde /fonts
  // La app habla solo con su propio backend por Server Actions.
  `connect-src 'self'${DEV ? " ws:" : ""}`,
  `frame-ancestors ${FRAME_ANCESTORS}`,
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(DEV ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/**
 * CSP del reporte de medidores. Es un documento suelto que se arma como string
 * en lib/reportes/medidores-html.js, con estilos y handlers inline, y que hoy
 * carga html2canvas y jspdf desde jsdelivr para el botón "Descargar PDF".
 *
 * Ese CDN es el hallazgo 4.4 de AUDITORIA_SEGURIDAD.md y sigue abierto: si se
 * resuelve (pasar a `window.print()`), este bloque desaparece y el reporte queda
 * cubierto por CSP_APP.
 */
const CSP_REPORTE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  `frame-ancestors ${FRAME_ANCESTORS}`,
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const CABECERAS_BASE = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // X-Frame-Options no sabe decir "solo este sitio": sus únicos valores vivos son DENY
  // y SAMEORIGIN — ALLOW-FROM lo abandonaron todos los navegadores. Así que cuando hay
  // un sitio autorizado la única salida es NO mandar esta cabecera y dejar que mande
  // `frame-ancestors`, que sí acepta un origen. Mandar las dos con criterios distintos
  // no negocia: gana la más restrictiva y el iframe queda bloqueado igual.
  ...(EMBEBIBLE_EN ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // La cámara SÍ se usa: el flujo "Tomar foto" en móvil abre la cámara trasera
  // con <input capture="environment">. Se permite en este origen y se niega al
  // resto; negarla entera rompe una función que hoy funciona.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // El prototipo original vive en `proto/` e `index.html` (scripts Babel en el
  // navegador). Durante la migración se mantienen como referencia de lectura y
  // no forman parte del build de Next.
  reactStrictMode: true,

  // `X-Powered-By: Next.js` no aporta nada y anuncia el stack en cada respuesta.
  poweredByHeader: false,

  // pdfjs-dist y xlsx se usan solo en el servidor (lib/extractores/). Quedan
  // fuera del bundle para que Next no intente empaquetar la build legacy de
  // pdfjs, que hace resolución dinámica de archivos.
  serverExternalPackages: ["pdfjs-dist", "xlsx"],

  // pdf.mjs carga su worker con un import dinámico de ruta calculada, así que el
  // trazado de dependencias no lo ve y el archivo no viajaba en la función: al
  // procesar un documento fallaba con "Setting up fake worker failed: Cannot find
  // module '.../pdf.worker.mjs'". Se incluye a mano en la ruta que extrae.
  outputFileTracingIncludes: {
    "/registrar/subir": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },

  experimental: {
    serverActions: {
      // Los adjuntos (facturas, boletas, fotos) viajan dentro del FormData de un
      // Server Action. El default de Next es 1 MB: con dos facturas escaneadas
      // se pasaba y el request moría con un 500 sin mensaje. Ver
      // lib/domain/archivos.js, que además valida en el cliente antes de enviar.
      bodySizeLimit: BODY_SIZE_LIMIT,
    },
  },

  /**
   * OJO CON EL ORDEN Y CON LA EXCLUSIÓN. Cuando dos reglas matchean la misma
   * ruta, el navegador recibe DOS cabeceras CSP y aplica la intersección de las
   * dos, o sea la más estricta de cada directiva. Si /medidores/reporte cayera
   * también en la regla general, jsdelivr quedaría bloqueado por CSP_APP y el
   * botón "Descargar PDF" dejaría de funcionar sin ningún error visible en el
   * servidor. Por eso la primera regla lo excluye explícitamente.
   */
  async headers() {
    return [
      {
        source: "/((?!medidores/reporte).*)",
        headers: [...CABECERAS_BASE, { key: "Content-Security-Policy", value: CSP_APP }],
      },
      {
        source: "/medidores/reporte",
        headers: [...CABECERAS_BASE, { key: "Content-Security-Policy", value: CSP_REPORTE }],
      },
      {
        // Nada de /api/ debería quedar en una caché intermedia.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
