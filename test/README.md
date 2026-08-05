# Pruebas

```bash
npm test
```

Runner de Node (`node:test`), sin dependencias nuevas. No hay Jest ni Vitest a
propósito: lo único que se prueba acá es la capa de escritura a Sheets, que es JS puro
sin React, y agregar un framework costaría más que lo que aporta.

## Qué se prueba, y qué no

Estas pruebas cubren **la capa de escritura y sus invariantes**, no la UI. Es una
elección deliberada: el modo de falla que motivó todo esto —dos sesiones editando a la
vez y borrándose el trabajo— no produce ningún error, ninguna pantalla rota y ningún
log. Solo datos que ya no están. Es exactamente el tipo de bug que ninguna cantidad de
clics encuentra y que una prueba de tres líneas fija para siempre.

| Archivo | Qué protege |
|---------|-------------|
| `medidores.test.mjs` | el patch del módulo Medidores y la escritura por clave |
| `emisiones.test.mjs` | idem para la hoja Emisiones, incluidos los refrigerantes por grupo |
| `registros.test.mjs` | `updateCeldasPorClave`: editar la fila del ID, no la de la posición |
| `encabezados.test.mjs` | detectar una columna movida; tolerar una renombrada |
| `invariantes.test.mjs` | que las actions de clear+rewrite no vuelvan |

`invariantes.test.mjs` merece una nota: no ejercita una función, protege una decisión.
Cada arreglo de este módulo se puede deshacer sin romper ninguna otra prueba —basta
volver a exponer una action vieja— y eso ya pasó una vez, cuando la migración al SDK
portó el clear+rewrite con fidelidad. Ahí está escrita la regla.

## El harness, y por qué es raro

Dos piezas fuera de lo común, las dos forzadas por el repo:

**`loader.mjs`** resuelve imports relativos sin extensión (`../instance`). Next los
resuelve solo; Node no. Sin esto, importar cualquier módulo de `lib/` falla.

**`mock.module`** (bandera `--experimental-test-module-mocks`) reemplaza
`lib/google/sheets-api.js` por una planilla en memoria. Es lo que permite probar el
upsert de verdad —indexar por clave, actualizar, agregar, borrar, y en qué orden— sin
tocar Google. También se mockea `server-only`, que lanza al importarse fuera de un
componente de servidor.

Los módulos bajo prueba se importan por `file://` URL absoluta (ver `raiz.mjs`) y no
con un import normal, porque `mock.module` identifica lo que intercepta por URL
resuelta: para reemplazar `./sheets-api` tal como lo ve `lib/google/actions.js`, hay
que nombrar el mismo archivo.

Si una versión de Node cambia el nombre de esa bandera, el arreglo está en el script
`test` de `package.json`.
