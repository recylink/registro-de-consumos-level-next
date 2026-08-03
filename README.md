# Registro de Consumos

Herramienta para que empresas registren sus consumos (electricidad, combustible,
agua) por sucursal y midan su impacto en emisiones GEI. Prototipo de validación
del futuro módulo oficial del software RECYLINK.

Next.js 16 (App Router) + React 19 en JS, desplegado en Vercel. El backend es un
Apps Script sobre una planilla de Google Sheets: la app no necesita login de
Google porque el script corre con la cuenta dueña de la planilla.

## Correr en local

```sh
npm install
cp .env.local.example .env.local   # completar APPS_SCRIPT_URL
npm run dev                        # http://localhost:3000
```

Sin `APPS_SCRIPT_URL` la app arranca en **modo local**: los loaders devuelven
datos vacíos y las escrituras fallan con un mensaje claro. Sirve para trabajar en
la UI sin tocar ninguna planilla real.

Verificar que el backend responde:

```sh
curl -s localhost:3000/api/health
```

## Variables de entorno

| Clave | Requerida | Qué es |
|-------|-----------|--------|
| `APPS_SCRIPT_URL` | sí | URL `/exec` del Apps Script desplegado sobre la planilla de esta instancia. Vacía = modo local. |
| `SPREADSHEET_URL` | no | URL de la planilla, solo para el link "ver planilla" de la UI. |

Ninguna lleva prefijo `NEXT_PUBLIC_`: se leen solo en el servidor, así el
endpoint no viaja al navegador. Los ~25 IDs de carpetas de Drive **no** son
variables de entorno — los crea la acción `setup` del Apps Script y viven en la
hoja "Config".

En Vercel, las mismas claves como variables de entorno del proyecto.

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
app/          rutas del App Router, Server Actions, /api/health
components/   vistas (una por pantalla), primitivas UI, gráficos SVG, shell
lib/          datos server-side: sheets, drive, extractores PDF/XLSX, dominio
ds/           design system (tokens CSS + tipografía)
appscripts/   snapshots congelados del Apps Script + changelog
_legacy/      el prototipo original (HTML único + React por CDN), solo referencia
```

## Documentación

- **[ARQUITECTURA.md](ARQUITECTURA.md)** — decisiones de diseño, dónde vive qué,
  puesta en marcha de una instancia nueva (planilla + Apps Script + Drive), y las
  correcciones hechas durante el port.
- **[CONTEXT.md](CONTEXT.md)** — el modelo de dominio: qué es una Sucursal, un
  Registro, un Medidor, una Recarga, y qué términos evitar.
- **[apps-script.gs](apps-script.gs)** — el backend. Al modificarlo hay que subir
  `SCRIPT_VERSION`, guardar el snapshot en `appscripts/` y re-implementar como
  nueva versión de la implementación existente (la URL no cambia).
