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

Nada se ha verificado todavía contra datos reales: el port se validó con datos
sintéticos y con el build.

## Módulo Medidores

Es la única pantalla con edición celda por celda (una lectura por medidor y mes),
y por eso la que más se aparta del resto:

- **El estado editable vive en el cliente.** `components/medidores/estado.jsx`
  siembra el módulo con lo que leyó el servidor y desde ahí manda el navegador,
  con guardado automático a los 900ms (el Apps Script reescribe las tres hojas por
  escritura y serializa con un lock, así que no se puede guardar por tecla). Los
  guardados se encolan y un fallo se avisa por toast; en el prototipo un error de
  guardado era solo un `console.error`.
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

**Modo local.** Sin `APPS_SCRIPT_URL`, los loaders de `lib/data.js` devuelven
datos vacíos y las escrituras fallan con un mensaje claro. Permite desarrollar
sin tocar ninguna planilla real.

**Errores que se leen.** Los Server Actions devuelven `{ ok, error }` en vez de
lanzar: una excepción cruzando el límite servidor→cliente llega al navegador sin
el mensaje real, y estos son justamente los que el usuario necesita ver
("backend no configurado", "carpeta sin configurar").

**Los IDs de Drive no son configuración de deploy.** Son ~25 y crecen con cada
proveedor. La acción `setup` del Apps Script crea el árbol bajo una carpeta raíz
y guarda el mapa en la clave `driveFolders` de la hoja "Config". Agregar un
proveedor no obliga a redeployar la app.

## Puesta en marcha de una instancia

1. Planilla nueva y vacía en Google Sheets. Las pestañas las crea el script.
2. Extensiones → Apps Script → pegar `apps-script.gs` completo → guardar.
3. Implementar → Nueva implementación → Aplicación web, ejecutar como **yo**,
   acceso **cualquier usuario** → autorizar → copiar la URL `/exec`.
4. Una carpeta raíz en Drive. Copiar su ID (el tramo después de `/folders/`).
5. Provisión (idempotente). **Sin `-X POST`**: el `/exec` responde 302 al
   `googleusercontent` que sirve el resultado, y `-X` fuerza a repetir el POST
   contra ese destino, que responde 411 (o una página HTML de Google). Con `-d`
   la primera petición ya es POST y el redirect se sigue como GET, que es lo que
   Apps Script espera:
   ```sh
   curl -sL "<URL>/exec" -H "Content-Type: text/plain" \
     -d '{"action":"setup","rootFolderId":"<ID de la carpeta raíz>"}'
   ```
   Con payloads que lleven base64 o acentos, mándalos desde archivo
   (`--data-binary @payload.json`) para que no los rompa el shell.
6. `cp .env.local.example .env.local` y poner `APPS_SCRIPT_URL`.
7. Verificar: `curl -s localhost:3000/api/health` debe responder con
   `"version": "v4"`.

## Backend: migración de Apps Script al SDK de Google APIs

Encargo de TI (coworking del 2026-07-30): la app le habla **directo** a Sheets y
Drive con una service account, en vez de pasar por el `/exec` del Apps Script —
que era una aplicación web con acceso "cualquier usuario", o sea un endpoint
público que aceptaba escrituras de quien tuviera la URL. El objetivo de fondo es
que los archivos de Drive puedan ser privados.

Va **de a una action**, con los dos backends conviviendo. La costura son `apiGet` y
`apiPost` de `lib/apps-script.js`: enrutan por action según la env var
`RC_SDK_ACTIONS`, así que migrar una no toca ninguno de los ocho consumidores de
`lib/`, y sacarla de esa lista la revierte sin revertir código.

| Bloque | Actions | Estado |
|--------|---------|--------|
| A | las 8 lecturas | migrado |
| B | `append` · `update` · `updateCells` | migrado |
| C | `setConfig` · `setConfigSucursales` · `setEmissions` · las 3 de Medidores | migrado |
| D | `upsertSucursal` · `deleteSucursal` | migrado |
| E | `upload` · `move` · `deleteFile` | **bloqueado**: una service account no tiene cuota propia en Drive, así que crear archivos exige Unidad compartida (Workspace) o delegación de dominio |
| F | `notifyFotoPending` | **bloqueado**: `MailApp` no existe en el SDK |
| G | `setup` · `init` | provisión, va al final |

`lib/google/` tiene la traducción: `auth.js` (service account desde env vars),
`sheets-api.js` (helpers de bajo nivel), `actions.js` (una entrada por action) y
`headers.js` (los encabezados que el `.gs` tenía en `WEB_CFG.HEADERS`).

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

### El Apps Script mientras dure

Sigue sirviendo las 5 actions que faltan. Al modificarlo: subir `SCRIPT_VERSION`,
guardar el snapshot en `appscripts/vN_fecha.gs`, anotar en
`appscripts/CHANGELOG.md` y re-implementar como **nueva versión** de la
implementación existente (la URL no cambia).

`lib/google/headers.js` duplica `WEB_CFG.HEADERS` del `.gs`. Es a propósito
mientras haya actions en el `/exec`: si se toca una, tocar la otra. Un desajuste
solo se nota cuando una hoja se crea de cero.

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
