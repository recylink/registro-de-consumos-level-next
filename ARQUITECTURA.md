# Arquitectura — Registro de Consumos (Next.js)

Versión formal del producto: Next.js 16 (App Router) + React 19 en JS, desplegada
en Vercel. Reemplaza al prototipo de `index.html` + `proto/*.jsx`, que cargaba
React y Babel por CDN y compilaba JSX en el navegador.

El prototipo sigue en el repo (`index.html`, `proto/`, `screens/`) como
referencia de lectura durante la migración. No participa del build de Next.

## Estado de la migración

| Fase | Qué | Estado |
|------|-----|--------|
| F0 | Andamiaje Next (build, CSS, fuentes, env) | listo |
| F1 | Capa de datos server-side (`lib/`, `app/actions/`) | listo |
| F2 | Rutas del App Router + shell como layout | listo |
| F3 | Port de las vistas | 14 de 16 · falta Medidores |
| F4 | Extractores PDF/XLSX por npm (sin CDN) | listo |
| F5 | Deploy en Vercel | pendiente (requiere login) |

### Pantallas portadas

Inicio · Dashboard · Matriz de carga · Impacto · Factores · Metas · Registrar
(hub) · Registro manual · Subir documento (+ revisión) · Tomar foto (+ completar)
· Configuración · Editar sucursal · Puesta en marcha.

Pendiente: **Medidores** y **Medidores móvil** (`proto/medidores.jsx`, 1.429
líneas + `proto/medidores-calc.jsx`). El cálculo ya está portado en
`lib/domain/medidores-calc.js` y los Server Actions en `app/actions/medidores.js`;
falta la interfaz (pestañas resumen/matriz/mensual/pagos, alta de medidores,
export a Excel y la vista de terreno).

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

**Nada de secretos en el cliente.** `APPS_SCRIPT_URL` se lee solo en el
servidor; `lib/instance.js` y todo `lib/sheets/` importan `server-only`, así el
build falla si un componente cliente los arrastra. En el prototipo la URL del
endpoint estaba en el bundle y cualquiera podía escribir en la planilla.

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
5. Provisión (idempotente):
   ```sh
   curl -L -X POST "<URL>/exec" -H "Content-Type: text/plain" \
     -d '{"action":"setup","rootFolderId":"<ID de la carpeta raíz>"}'
   ```
6. `cp .env.local.example .env.local` y poner `APPS_SCRIPT_URL`.
7. Verificar: `curl -s localhost:3000/api/health` debe responder con
   `"version": "v4"`.

## Backend

El Apps Script (`apps-script.gs`) sigue siendo el backend: expone un `/exec`
público que multiplexa por `action`, corre con la cuenta dueña de la planilla y
por eso la app no necesita login de Google. Snapshots congelados en
`appscripts/`, versión activa en `SCRIPT_VERSION` (visible en
`/api/health`).

Al modificar el script: subir `SCRIPT_VERSION`, guardar el snapshot en
`appscripts/vN_fecha.gs`, anotar en `appscripts/CHANGELOG.md` y re-implementar
como **nueva versión** de la implementación existente (la URL no cambia).

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
