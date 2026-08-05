// Resuelve imports relativos sin extensión ("../instance"), que Next resuelve
// solo y Node no. Devuelve un file:// URL armado a mano en vez de reintentar por
// `next`, que en Windows termina pasando "C:\..." como si fuera un URL.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const EXTS = [".js", ".jsx", "/index.js", "/index.jsx"];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of EXTS) {
      const cand = new URL(base.href + ext);
      if (fs.existsSync(fileURLToPath(cand))) {
        return { url: cand.href, format: "module", shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}
