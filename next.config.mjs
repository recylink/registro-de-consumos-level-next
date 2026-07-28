/** @type {import('next').NextConfig} */
const nextConfig = {
  // El prototipo original vive en `proto/` e `index.html` (scripts Babel en el
  // navegador). Durante la migración se mantienen como referencia de lectura y
  // no forman parte del build de Next.
  reactStrictMode: true,
};

export default nextConfig;
