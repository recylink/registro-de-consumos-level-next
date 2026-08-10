# Registro de Consumos

Herramienta para que empresas registren sus consumos (electricidad, combustible,
agua) por sucursal y midan su impacto en emisiones GEI. Prototipo de validación
del futuro módulo oficial del software RECYLINK.

Next.js 16 (App Router) + React 19 en JS, desplegado en Vercel. Los datos viven en
una planilla de Google Sheets y los documentos en Drive; la app les habla directo con
una **service account**, así que nadie necesita login de Google para usarla. Antes
todo pasaba por un Apps Script; le queda una sola cosa, el correo de "foto pendiente".

## Correr en local

```sh
npm install
cp .env.local.example .env.local   # completar las claves de la service account
npm run dev                        # http://localhost:3000
```

Sin ningún backend configurado la app arranca en **modo local**: los loaders devuelven
datos vacíos y las escrituras fallan con un mensaje claro. Sirve para trabajar en la UI
sin tocar ninguna planilla real.

Verificar que el backend responde:

```sh
curl -s localhost:3000/api/health
```

## Variables de entorno

| Clave | Requerida | Qué es |
|-------|-----------|--------|
| `GOOGLE_CLIENT_EMAIL` | sí | La service account. Hay que compartirle la planilla como Editor. |
| `GOOGLE_PRIVATE_KEY` | sí | Su clave privada, en una línea y con los saltos como `\n` escapados. El JSON **no** va al repo. |
| `SPREADSHEET_ID` | sí | La planilla de esta instancia. Acepta la URL completa. |
| `RC_SDK_ACTIONS` | sí | Qué operaciones salen por el SDK. Se copia tal cual de `.env.local.example`. |
| `APPS_SCRIPT_URL` | sí | URL `/exec` del Apps Script. Ya solo sirve el correo de "foto pendiente"; sin ella todo lo demás funciona. |
| `SITE_PASSWORD` | no | Contraseña compartida para entrar al sitio. Vacía = sitio abierto. |
| `SPREADSHEET_URL` | no | Solo para el link "ver planilla" de la UI. |
| `GOOGLE_PROJECT_ID` | no | Informativo. |

Ninguna lleva prefijo `NEXT_PUBLIC_`: se leen solo en el servidor, así ni el endpoint
ni las credenciales viajan al navegador. Los ~25 IDs de carpetas de Drive **no** son
variables de entorno — los crea la provisión (`POST /api/migracion/setup`) y viven en
la hoja "Config".

En Vercel, las mismas claves como variables de entorno del proyecto. Cada una está
documentada con su por qué en `.env.local.example`.

## Scripts

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | servidor de desarrollo |
| `npm run build` | build de producción |
| `npm start` | servir el build |
| `npm run lint` | lint |

## Deploy

Por ahora manual: `npx vercel --prod --yes`.

La integración git con Vercel está pendiente de autorización del admin de la org
en GitHub. Cuando se conecte, cada push a `main` desplegará producción y las demás
ramas generarán preview URLs. Ver [ARQUITECTURA.md](ARQUITECTURA.md#estado-de-la-migración).

## Estructura

```
app/          rutas del App Router, Server Actions, /api/health, /api/migracion
components/   vistas (una por pantalla), primitivas UI, gráficos SVG, shell
lib/          datos server-side: google (SDK), sheets, drive, extractores, dominio
ds/           design system (tokens CSS + tipografía)
appscripts/   snapshots congelados del Apps Script + changelog
_legacy/      el prototipo original (HTML único + React por CDN), solo referencia
```

## Documentación

- **[ARQUITECTURA.md](ARQUITECTURA.md)** — decisiones de diseño, dónde vive qué,
  puesta en marcha de una instancia nueva (planilla + service account + Drive), la
  migración del Apps Script al SDK y cómo se verificó, y las correcciones hechas
  durante el port.
- **[CONTEXT.md](CONTEXT.md)** — el modelo de dominio: qué es una Sucursal, un
  Registro, un Medidor, una Recarga, y qué términos evitar.
- **[apps-script.gs](apps-script.gs)** — lo que queda del backend viejo: dos actions,
  `notifyFotoPending` y `ping`. Al modificarlo hay que subir `SCRIPT_VERSION`, guardar
  el snapshot en `appscripts/` y re-implementar como nueva versión de la implementación
  existente (la URL no cambia).
