// Raíz del repo y armado de URLs de módulo para las pruebas.
//
// Los módulos bajo prueba se importan por `file://` URL absoluta y no por un import
// relativo normal, porque `mock.module` identifica lo que intercepta por su URL
// resuelta: para reemplazar `./sheets-api` tal como lo ve `lib/google/actions.js`,
// hay que nombrar el mismo archivo.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const url = (rel) => pathToFileURL(path.join(RAIZ, rel)).href;
