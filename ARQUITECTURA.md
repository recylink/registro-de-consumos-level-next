# Arquitectura — Registro de Consumos (Next.js)

Versión formal del producto: Next.js 16 (App Router) + React 19 en JS, desplegada
en Vercel. Reemplaza al prototipo de `index.html` + `proto/*.jsx`, que cargaba
React y Babel por CDN y compilaba JSX en el navegador.

El prototipo quedó archivado en **`_legacy/`** (`index.html`, `proto/`, `screens/`
y sus dos hojas de estilo) el 2026-07-29, al terminar el port. Sigue en el repo
como referencia histórica y no participa del build. Los comentarios del código
citan los archivos originales como `proto/x.jsx`: hoy son `_legacy/proto/x.jsx`.

## Estado de la migración

| Fase | Qué | Estado |
|------|-----|--------|
| F0 | Andamiaje Next (build, CSS, fuentes, env) | listo |
| F1 | Capa de datos server-side (`lib/`, `app/actions/`) | listo |
| F2 | Rutas del App Router + shell como layout | listo |
| F3 | Port de las vistas | listo (16 de 16) |
| F4 | Extractores PDF/XLSX por npm (sin CDN) | listo |
| F5 | Deploy en Vercel | listo |

El repo vive en `recylink/registro-de-consumos-next` (privado) y el proyecto
Vercel es `registro-de-consumos-next`.

La integración git está **pendiente**: espera que un admin de la org autorice la
Vercel app en GitHub. Hasta entonces el deploy es manual —
`npx vercel --prod --yes` — y un push a `main` no despliega nada. Al autorizarse,
conectar desde Settings → Git del proyecto existente (no importar el repo de
cero, que crearía un segundo proyecto sin las env vars); desde ahí `main` es
producción y las demás ramas dan preview URLs.

### Pantallas portadas

Inicio · Dashboard · Matriz de carga · Impacto · Factores · Metas · Registrar
(hub) · Registro manual · Subir documento (+ revisión) · Tomar foto (+ completar)
· Configuración · Editar sucursal · Puesta en marcha · **Medidores** · **Medidores
móvil**.

Las pantallas se validaron con datos sintéticos y con el build. La capa de datos sí
está verificada contra la planilla real: la migración al SDK se fue midiendo action
por action con los endpoints de `/api/migracion/` (ver "Verificación").

## Módulo Medidores

Es la única pantalla con edición celda por celda (una lectura por medidor y mes),
y por eso la que más se aparta del resto:

- **El estado editable vive en el cliente.** `components/medidores/estado.jsx`
  siembra el módulo con lo que leyó el servidor y desde ahí manda el navegador,
  con guardado automático a los 900ms. Los guardados se encolan y un fallo se avisa
  por toast; en el prototipo un error de guardado era solo un `console.error`.
- **Se guarda un patch, no el módulo.** Lo que viaja al servidor es la diferencia
  entre el último estado confirmado y el actual, y el servidor escribe fila por
  fila buscándolas por su clave natural (`lib/domain/medidores-patch.js`,
  `upsertPorClave` en `lib/google/actions.js`).

  Antes se mandaba el módulo completo y se reescribían las tres hojas enteras. Eso
  hacía que la planilla quedara igual a la copia del último que guardó: dos
  dispositivos editando a la vez se borraban el trabajo, y el debounce lo empeoraba
  porque la copia que se manda puede tener minutos de atraso. El `LockService` del
  Apps Script serializaba las escrituras pero no detectaba lecturas obsoletas, y el
  SDK no tiene ni siquiera el lock.

  Diffear del lado del servidor no habría alcanzado: si el cliente manda la tabla
  entera, "esta fila no viene" es ambiguo entre "la borré" y "nunca la vi". Por eso
  el diff se calcula contra el estado confirmado del propio cliente, donde la
  ausencia sí significa borrado.
- **La selección no es parte del documento.** Sucursal, tipo, pestaña y período
  son estado de la pantalla. En el prototipo vivían en el mismo objeto que se
  sincronizaba con la planilla.
- **El Excel se arma en el servidor** (`lib/reportes/medidores-excel.js` +
  `exportMedidoresExcelAction`) y vuelve en base64: la librería `xlsx` (~400 kB) no
  entra al bundle del navegador. El módulo lo manda el cliente, no se relee de la
  planilla, para no exportar una lectura vieja recién escrita.
- **El reporte imprimible es una ruta** (`/medidores/reporte`,
  `lib/reportes/medidores-html.js`). Antes se generaba con `document.write` sobre
  una ventana nueva, así que existía solo mientras esa pestaña viviera. Ahora es un
  link con parámetros; la pantalla fuerza el guardado pendiente antes de abrirlo,
  porque el reporte lee de la planilla.

## Dónde vive qué

```
app/
├── layout.jsx          # html/body + globals.css
├── globals.css         # tokens del DS + estilos del prototipo
├── styles/             # tokens.css · proto.css · rc-auth.css
├── api/health/         # diagnóstico: endpoint configurado + versión del script
├── api/version/        # identidad del deploy, para el aviso de versión nueva
└── actions/            # Server Actions — toda escritura pasa por acá
components/
├── icons.jsx           # los 60 iconos SVG
├── ui/                 # primitivas; layout.jsx sirve en servidor, controls.jsx no
├── charts/             # líneas, área y heatmap, SVG a mano
├── shell/              # sidebar, chrome y aviso de deploy nuevo
└── views/              # una pantalla por archivo
lib/
├── extractores/        # parsers de boleta + pdfjs/xlsx (solo servidor)
├── instance.js         # EMPRESA, nombres de hojas, lectura de env
├── apps-script.js      # transporte contra el /exec + etiquetas de caché
├── drive.js            # subir / mover / eliminar archivos
├── drive-folders.js    # IDs de carpetas (viven en la hoja Config)
├── data.js             # fachada de lectura para componentes de servidor
├── flows.js            # flujos que combinan Drive + Sheets
├── result.js           # forma { ok, error } de los Server Actions
├── domain/             # catálogo y parsers — puro, isomorfo
└── sheets/             # una hoja por módulo: flatten/unflatten + lectura/escritura
```

## Decisiones

**Nada de secretos en el cliente.** `APPS_SCRIPT_URL` y la clave privada de la
service account se leen solo en el servidor; `lib/instance.js`, `lib/google/` y
todo `lib/sheets/` importan `server-only`, así el build falla si un componente
cliente los arrastra. En el prototipo la URL del endpoint estaba en el bundle y
cualquiera podía escribir en la planilla.

El JSON de credenciales **no va al repo** (regla de TI): la service account viaja
en `GOOGLE_CLIENT_EMAIL` y `GOOGLE_PRIVATE_KEY`, esta última en una línea con los
saltos como `\n` escapados. Ver `.env.local.example`.

**Server Actions, no route handlers.** Las mutaciones son funciones importables
desde los componentes; no hay API REST intermedia que mantener sincronizada. El
único route handler es `/api/health`, que es diagnóstico.

**Lecturas cacheadas por etiqueta.** Cada lectura se marca con su tag
(`lib/apps-script.js`, `TAGS`) y cada mutación invalida solo lo que tocó con
`revalidateTag`. Reemplaza al `rcRefreshDashboard()` global del prototipo, que
recargaba todo ante cualquier cambio.

**Modo local.** Sin NINGÚN backend configurado, los loaders de `lib/data.js`
devuelven datos vacíos y las escrituras fallan con un mensaje claro. Permite
desarrollar sin tocar ninguna planilla real.

"Ningún backend" son dos preguntas distintas desde que existe el SDK, y confundirlas
fue un bug real: `isConfigured()` miraba solo `APPS_SCRIPT_URL` y se usaba como si
significara "hay con qué leer". Con la service account puesta y sin la URL del
`/exec` —20 de 24 actions funcionando— todas las pantallas salían vacías. Hoy son
dos funciones en `lib/instance.js`:

- `appsScriptConfigurado()` — la usa el transporte del `/exec` para fallar claro.
- `hayBackend()` — Apps Script **o** SDK. La usan `lib/data.js` y el aviso de la UI.

**Errores que se leen.** Los Server Actions devuelven `{ ok, error }` en vez de
lanzar: una excepción cruzando el límite servidor→cliente llega al navegador sin
el mensaje real, y estos son justamente los que el usuario necesita ver
("backend no configurado", "carpeta sin configurar").

**Los IDs de Drive no son configuración de deploy.** Son ~25 y crecen con cada
proveedor. La provisión (`setup`) crea el árbol bajo una carpeta raíz y guarda el
mapa en la clave `driveFolders` de la hoja "Config". Agregar un proveedor no obliga
a redeployar la app.

## Puesta en marcha de una instancia

La provisión la corre la app con la service account, **desde local**. Antes se hacía
con un `curl` al `/exec`; la action `setup` se retiró del script en `v6` porque
reescribía el mapa de carpetas de la instancia y no le pedía credenciales a nadie.

1. Planilla nueva y vacía en Google Sheets. Las pestañas las crea la app.
2. Service account en el proyecto de Cloud, con la **API de Sheets y la de Drive
   habilitadas** (las dos: con la de Drive apagada, Sheets funciona y Drive falla con
   un error que no la menciona). Descargar el JSON de la clave.
3. Compartir la planilla con `GOOGLE_CLIENT_EMAIL` como **Editor**, o toda lectura
   responde 403 "The caller does not have permission".
4. Una carpeta raíz en Drive, **dentro de una Unidad compartida**, con la service
   account como miembro con permiso de escritura. En "Mi unidad" de una persona no
   sirve: una service account no tiene cuota propia y no puede crear archivos ahí.
   Copiar el ID de la carpeta (el tramo después de `/folders/`).
5. `cp .env.local.example .env.local` y completar `GOOGLE_CLIENT_EMAIL`,
   `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID` y `RC_SDK_ACTIONS`.
6. Provisión (idempotente: correrla de nuevo devuelve los mismos IDs). Crea las hojas
   y el árbol de ~25 carpetas, y deja los IDs en la clave `driveFolders` de la hoja
   "Config":
   ```sh
   npm run dev
   curl -s  http://localhost:3000/api/migracion/setup            # informe, no escribe
   curl -s -X POST 'http://localhost:3000/api/migracion/setup?rootFolderId=<ID>'
   ```
   Sobre una instancia ya provisionada el POST responde 409 y hay que repetirlo con
   `&forzar=si`. No es burocracia: sobre **otra** raíz `setup` no falla ni avisa —crea
   un árbol nuevo y reescribe el mapa—, y la app quedaría subiendo a las carpetas
   nuevas con los adjuntos viejos inalcanzables. Con `forzar` la respuesta trae
   `cambios` (las claves cuyo ID quedó distinto) y `antes` (el valor anterior, crudo,
   para volver atrás).
7. El correo de "foto pendiente" es lo único que sigue en Apps Script, así que hace
   falta el `/exec`: Extensiones → Apps Script → pegar `apps-script.gs` → Implementar
   → Aplicación web, ejecutar como **yo**, acceso **cualquier usuario** → autorizar →
   copiar la URL en `APPS_SCRIPT_URL`. Los destinatarios se cargan desde la app, en
   Configuración → "Avisos de cola pendiente"; sin ninguno, la clave
   `fotoNotifEmails` no existe en la hoja "Config" y el aviso no se manda a nadie,
   en silencio.
8. Verificar: `curl -s localhost:3000/api/health` responde con los dos backends. El
   lado Apps Script debe traer `"version": "v6"`; si trae una anterior, la
   implementación quedó apuntando a una versión vieja del script.

## Backend: migración de Apps Script al SDK de Google APIs

Encargo de TI (coworking del 2026-07-30): la app le habla **directo** a Sheets y
Drive con una service account, en vez de pasar por el `/exec` del Apps Script —
que era una aplicación web con acceso "cualquier usuario", o sea un endpoint
público que aceptaba escrituras de quien tuviera la URL. El objetivo de fondo es
que los archivos de Drive puedan ser privados.

Fue **de a una action**, con los dos backends conviviendo. La costura son `apiGet` y
`apiPost` de `lib/apps-script.js`: enrutan por action según la env var
`RC_SDK_ACTIONS`, así que migrar una no toca ninguno de los ocho consumidores de
`lib/`, y sacarla de esa lista la revierte sin revertir código.

**Cerrada el 2026-08-10**, salvo `notifyFotoPending`. De las 24 actions del `.gs`, 23
las sirve el SDK y el script quedó con dos (`notifyFotoPending` y `ping`, script `v6`).
El interruptor no se retira: mientras `RC_SDK_ACTIONS` siga siendo una lista por
nombre, sacar una action de ahí la manda de vuelta al `/exec` — pero eso hoy ya no es
una vuelta atrás real, porque el script no las implementa.

| Bloque | Actions | Estado |
|--------|---------|--------|
| A | las 8 lecturas | migrado |
| B | `append` · `update` · `updateCells` | migrado |
| C | `setConfig` | migrado |
| C' | las 3 de Medidores (`setSheetRows`) · `setEmissions` · `setConfigSucursales` | **reemplazadas**, no traducidas — ver abajo |
| D | `upsertSucursal` · `deleteSucursal` | migrado |
| E | `upload` · `move` · `deleteFile` | migrado |
| F | `notifyFotoPending` | **se queda en Apps Script**, por decisión — `MailApp` no existe en el SDK |
| G | `init` · `setup` | migrado |

**La excepción a la fidelidad.** Todo lo demás replica su action del `.gs` firma
por firma, para que la migración fuera comparable contra el backend viejo. Los
`clear()` + reescribir la hoja completa no: eran la causa concreta de pérdida de
datos, y traducirlos con fidelidad habría portado el bug a un backend que además
perdió el `LockService`. En su lugar hay cuatro actions nuevas que escriben por
clave:

| Reemplaza | Nueva action | Alcance de una escritura |
|-----------|--------------|--------------------------|
| `setSheetRows` × 3 (Medidores) | `upsertMedidores` · `upsertLecturasMedidor` · `upsertPreciosMedidor` | las filas del patch |
| `setEmissions` | `upsertEmisiones` | las filas del patch; los refrigerantes, por sucursal |
| `setConfigSucursales` | `upsertSucursal`, una vez por sucursal | las filas de una sucursal |

Los tres nombres de Medidores **no** están implementados en el SDK a propósito: si
aparecieran en `RC_SDK_ACTIONS`, el router caería al `/exec`, donde `setSheetRows`
sigue vivo y volvería a hacer el clobber. `setEmissions` sí sigue implementada, pero
solo porque `/api/migracion/probe-c` la usa para comparar los dos backends sobre una
hoja que crea y borra; nada de la app la llama.

Por eso las actions sin equivalente en el `.gs` salen por `apiPostSoloSdk`, que falla
con un mensaje que nombra el env var en vez de degradar al backend viejo.

**`reemplazarHoja` queda como excepción, no como regla.** Sirve donde la hoja tiene
un solo escritor y se reescribe entera por diseño: `setConfigSucursales`, que hoy solo
usa el onboarding. No sirve para nada que se edite celda por celda desde la UI.

**Identidad de las filas.** Las tres hojas de consumo tienen una columna `ID` al
final, y `updateCeldasPorClave` es el `UPDATE ... WHERE` que la API de valores no
tiene: busca la fila por su ID y escribe solo las celdas pedidas. Antes la identidad
de un registro era su posición (`comb-12` = la fila 14), que queda inválida en cuanto
alguien ordena la planilla — y escribir en la fila equivocada no da ningún error.
La columna la agrega `/api/migracion/columna-id` (informe por GET, aplicar por POST
con `?aplicar=si`), que deja `registrosConId: true` en la hoja "Config"; ese flag es
lo que enciende la escritura de ids en los `append`. Mientras no exista, la app
vuelve al id posicional y se comporta como antes.

**Encabezados.** `lib/sheets/encabezados.js` compara el encabezado real contra el
esperado antes de leer nada por posición. Una columna **movida o borrada** corta la
lectura con un mensaje que dice cuál y dónde; una **renombrada** —o escrita sin
tilde, que es el caso real— solo deja un aviso en el log, porque los datos se siguen
leyendo bien. Resolver las columnas por nombre habría sido lo obvio y es peor: el
encabezado lo editan personas, así que renombrar una columna pasaría de inofensivo a
romper la lectura.

`lib/google/` tiene la traducción: `auth.js` (service account desde env vars),
`sheets-api.js` (helpers de bajo nivel), `actions.js` (una entrada por action) y
`headers.js` (los encabezados que el `.gs` tenía en `WEB_CFG.HEADERS`).

### Drive: cómo se desbloqueó

El bloque estuvo parado semanas y el primer diagnóstico fue equivocado dos veces.
Primero se dio por sentado que el problema era la cuota de almacenamiento de una
service account; medido con `/api/diagnostico/drive`, apareció que además la **API de
Drive no estaba habilitada** en el proyecto de Cloud `recylink` (551899594359) — la de
Sheets sí. Habilitarla destapó el problema real, que sí era la cuota:
`storageQuota.limit: "0"`. Una service account no puede crear archivos en "Mi unidad"
de nadie, ni mandar a la papelera lo que no es suyo.

Lo que lo resolvió, el **2026-08-06**, fue mover las carpetas de la app a una **Unidad
compartida**: adentro los archivos son de la unidad y no de quien los crea, así que la
falta de cuota deja de importar. El precio es un flag: **todas** las llamadas a Drive
llevan `supportsAllDrives: true`, y sin él la API contesta "File not found" sobre un
archivo que está ahí — un error que se diagnostica como permisos y no lo es
(`lib/google/drive-api.js`).

**Mail (`notifyFotoPending`), lo único que no se migra.** Se queda en el Apps Script a
propósito. `MailApp` no tiene equivalente en el SDK, y las alternativas (API de Gmail con
delegación de dominio, o un proveedor tipo Resend) cuestan más que el beneficio
para una sola notificación. Consecuencia: `APPS_SCRIPT_URL` sigue siendo
**requerida**, y el `/exec` no se puede dar de baja.

### El `/exec`: migrar no lo cierra, recortarlo sí

Migrar las actions del lado de la app **no reduce la exposición**. El endpoint es
público y sin autenticación —"ejecutar como: yo" + "cualquier usuario"—, así que
mientras el script implemente una action, cualquiera con la URL la ejecuta. Y la URL
viajó en el JS de un frontend público: hay que tratarla como conocida.

Eso valía para el clobber de Medidores: la app ya no puede reescribir esas hojas, pero
`setSheetRows` seguía ahí y no le pedía credenciales a nadie. El arreglo del lado de la
app quita el modo de falla accidental —dos usuarios legítimos pisándose—, no el
deliberado.

**Y el cierre no estaba bloqueado por Drive, como se creyó un tiempo.** Solo cuatro
actions dependían de Workspace. Las otras 20 se podían retirar de inmediato, y `v5`
hizo eso: de 26 actions a 6. Con Drive desbloqueado, `v6` retira las cuatro que
quedaban de Workspace y el script baja a **dos**:

| Sigue | Por qué |
|-------|---------|
| `notifyFotoPending` | `MailApp` no existe en el SDK |
| `ping` | versión desplegada, para `/api/health` |

**La que más importaba retirar era `setup`.** Escribe la clave `driveFolders` de la hoja
"Config" con los IDs del árbol que cuelgue del `rootFolderId` que reciba, y no había nada
que validara ese ID: cualquiera con la URL podía apuntarla a una carpeta propia y la app
habría empezado a subir ahí los documentos de la empresa, sin ningún error a la vista. Es
el único de los seis casos donde la action retirada era una toma de control, no una
filtración. Su reemplazo es `POST /api/migracion/setup`, que se corre desde local con la
service account — ver "Puesta en marcha".

De lo que quedó, ninguna toca los datos de consumo: una manda un correo y la otra dice
qué versión corre. Además, desde `v5`, `doGet` sin `action` ya no hace `read` por defecto
— un GET pelado a la URL devolvía la planilla completa.

Lo que **no** se hizo: borrar el código inalcanzable. Lo que corre de verdad son cuatro
funciones (`doGet` → `ping`, y `doPost` → `notifyFotoPending` → `getConfigValue` →
`rcSpreadsheet`); todo el resto del archivo ya no se puede ejecutar por HTTP. Pero este
script convive con otros archivos en el mismo proyecto de Apps Script —el procesador de
Combustible, de donde viene el choque de nombres que obligó a llamarlo `WEB_CFG`— y esos
archivos pueden llamar a cualquiera de estas funciones sin que se vea desde el repo.
Borrarlas es una limpieza que se hace en el editor, mirando los otros archivos.

Recortar es editar el `.gs`, subir `SCRIPT_VERSION` y re-implementar como nueva versión
de la implementación existente — la URL no cambia.

### Lo que hay que saber antes de tocar esto

- **Los dos modos de lectura no son intercambiables.** El script mezclaba
  `getValues()` y `getDisplayValues()` según la hoja, y hay que respetarlo hoja por
  hoja: unificarlos deja a los parsers leyendo seriales de fecha en vez de
  `"31-07-26"`, sin lanzar ningún error.
- **`setValues()` equivale a `USER_ENTERED`**, medido con
  `/api/migracion/probe-escritura`, no supuesto.
- **Se escribe antes de borrar**, al revés del original. El Apps Script hacía
  `clear()` y después escribía, protegido por `LockService`; sin lock ese orden
  deja una ventana con la hoja vacía. Y no es teórico: en `probe-c` el Apps Script
  pierde las filas cuando la escritura falla la validación.
- **Las lecturas por SDK van por `unstable_cache`.** No es un lujo: la cuota de la
  API de Sheets es de 60 lecturas por minuto y por usuario, y sin caché el build
  la revienta. Las de Apps Script se cacheaban solas por ser `fetch`.

### Verificación

Que la pantalla se vea bien no prueba nada acá: las diferencias son mudas (una
fila más corta, un número sin formato, una fecha como serial). Endpoints de
desarrollo, todos bajo `/api/migracion/`:

| Endpoint | Qué prueba |
|----------|-----------|
| `diff` | corre cada lectura por los dos backends y compara celda por celda |
| `probe-escritura` | qué modo de escritura imita a `setValues()` |
| `probe-b` | efecto de las escrituras puntuales, en hojas descartables |
| `probe-c` | reescrituras: crear, encoger, vaciar, crecer |
| `probe-d` | filas por sucursal, con copia y restauración de la hoja real |
| `invalidar` | limpia las etiquetas de caché, para medir en frío |
| `probe-e` | Drive: `upload`/`move`/`deleteFile`, comparando el efecto en Drive y no la respuesta |
| `probe-g` | `init`: idempotencia y encabezado correcto al recrear una hoja |
| `probe-setup` | `setup`: mismas claves y mismo árbol de nombres, cada backend sobre una raíz de juguete |
| `columna-id` | GET: informe de qué filas les falta el ID. POST `?aplicar=si`: lo agrega |
| `lectura-cruda` | GET: qué celdas se leerían distinto al pasar a `UNFORMATTED_VALUE` |
| `setup` | no es una prueba: es la provisión de una instancia (ver "Puesta en marcha") |

**Los que comparan los dos backends dejan de funcionar a medida que el `/exec` se
recorta.** `diff`, `probe-b`, `probe-c` y `probe-d` se cayeron con `v5`; `probe-e` y la
mitad de `probe-setup` (la que corre el backend viejo), con `v6`. Escriben y leen por el
`/exec`, y esas actions ya no existen. Su trabajo está hecho: dejaron el registro de
paridad que justificó cada action migrada. Se conservan como documentación de cómo se
verificó, no como algo que se pueda volver a correr — correrlos exige volver a un script
anterior, y eso significa reabrir el endpoint.

Los últimos tres no son pruebas sino herramientas. `columna-id` y `setup` son los únicos
que escriben en la planilla real. `columna-id` solo con `?aplicar=si`: es idempotente
(nunca cambia un id ya asignado), verifica después de escribir, y no enciende su flag
si alguna hoja no verificó. `setup` es idempotente sobre la misma raíz y exige
`&forzar=si` si ya hay un mapa de carpetas. Aun así, duplicar la planilla antes es la
única vuelta atrás real. `lectura-cruda` no escribe nada.

### El Apps Script mientras dure

Sigue sirviendo dos actions: `notifyFotoPending` y `ping`. Al modificarlo: subir
`SCRIPT_VERSION`, guardar el snapshot en `appscripts/vN_fecha.gs`, anotar en
`appscripts/CHANGELOG.md` y re-implementar como **nueva versión** de la
implementación existente (la URL no cambia).

`lib/google/headers.js` duplica `WEB_CFG.HEADERS` del `.gs`. Ya ningún camino HTTP del
script crea hojas, así que un desajuste no puede romper la app: la fuente de verdad es
`headers.js`. La copia del `.gs` importa solo si se corre `setupInstance` o `ensureSheets`
a mano desde el editor, que es la vuelta atrás si la provisión por SDK falla a mitad de
camino. Si se toca una, tocar la otra.

## Correcciones hechas durante el port

Cosas que el prototipo prometía y no cumplía, encontradas al portar. Todas están
documentadas en el código y en el commit que las arregla.

| Dónde | Qué pasaba |
|-------|------------|
| `proto/extractors.jsx` (Enel) | El patrón de consumo era `(\d+)`, sin punto de miles: "Electricidad Consumida ( 20.440 kWh )" caía al fallback y guardaba **440**. |
| `proto/dashboard.jsx` | Las ediciones de la tabla solo se escribían en la planilla si el registro tenía origen `sheets`. En los demás, el cambio se veía y no se guardaba. |
| `proto/dashboard.jsx` | "Deshacer" revertía el valor en memoria y dejaba el nuevo en la planilla. |
| `proto/config-edit.jsx` | "Sí, actualizar todo" al renombrar una sucursal no tocaba la planilla. |
| `proto/config-edit.jsx` | "Eliminar también operaciones" llamaba a la misma función que "mantener operaciones". |
| `proto/factores.jsx` | El aviso "revisa tus valores personalizados" no podía aparecer: nada marcaba `pendingReview`. |
| `proto/metas.jsx` | "Guardar metas" solo mostraba un toast. |
| `proto/preview.jsx` | El estado de una fila no se recalculaba al completar la sucursal faltante. |
| `apps-script.gs` | Traía hardcodeado el ID de la planilla de otra instancia. |
| `proto/dashboard.jsx` | El botón "Crear nueva" de subcategorías no persistía nada. |
| `proto/metas.jsx` | Usaba el icono `history`, que no existe en el set. |
| `proto/medidores.jsx` | Un fallo al guardar lecturas era un `console.error`: la vista móvil seguía diciendo "Las lecturas se guardan automáticamente". |
| `proto/medidores.jsx` | El reporte calculaba la diferencia contra las boletas (`difChip`) y nunca la mostraba. Ahora tiene su sección. |
| `proto/medidores.jsx` | La preview de la foto de respaldo creaba un `objectURL` que nunca se liberaba. |
| `proto/medidores.jsx` | `PriceEditor` era un componente completo que nadie usaba (el precio se edita con `MedPriceInput`). No se portó. |
