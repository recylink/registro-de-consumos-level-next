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
};

export default nextConfig;
