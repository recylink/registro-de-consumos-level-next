import { BODY_SIZE_LIMIT } from "./lib/domain/archivos.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // El prototipo original vive en `proto/` e `index.html` (scripts Babel en el
  // navegador). Durante la migración se mantienen como referencia de lectura y
  // no forman parte del build de Next.
  reactStrictMode: true,

  // pdfjs-dist y xlsx se usan solo en el servidor (lib/extractores/). Quedan
  // fuera del bundle para que Next no intente empaquetar la build legacy de
  // pdfjs, que hace resolución dinámica de archivos.
  serverExternalPackages: ["pdfjs-dist", "xlsx"],

  experimental: {
    serverActions: {
      // Los adjuntos (facturas, boletas, fotos) viajan dentro del FormData de un
      // Server Action. El default de Next es 1 MB: con dos facturas escaneadas
      // se pasaba y el request moría con un 500 sin mensaje. Ver
      // lib/domain/archivos.js, que además valida en el cliente antes de enviar.
      bodySizeLimit: BODY_SIZE_LIMIT,
    },
  },
};

export default nextConfig;
