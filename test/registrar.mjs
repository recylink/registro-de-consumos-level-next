// Registra el resolver de imports sin extensión antes de cargar las pruebas.
// Se pasa con `--import` (ver el script `test` de package.json).
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
