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
| F2 | Rutas del App Router + shell como layout | pendiente |
| F3 | Port de las 16 vistas | pendiente |
| F4 | Extractores PDF/XLSX por npm (sin CDN) | pendiente |
| F5 | Deploy en Vercel | pendiente |

## Dónde vive qué

```
app/
├── layout.jsx          # html/body + globals.css
├── globals.css         # tokens del DS + estilos del prototipo
├── styles/             # tokens.css · proto.css · rc-auth.css
├── api/health/         # diagnóstico: endpoint configurado + versión del script
└── actions/            # Server Actions — toda escritura pasa por acá
lib/
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
