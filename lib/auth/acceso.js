// Muro de contraseña para el sitio.
//
// Sin `server-only`: lo importa `proxy.js`, que se empaqueta aparte de los
// componentes y con ese guard el build falla. La protección real es que
// `SITE_PASSWORD` no lleva prefijo NEXT_PUBLIC_, así que no existe en el bundle
// del navegador — y nada de acá se importa desde un componente cliente.
//
// Lo pidió TI (coworking del 2026-07-30) como "validación de contraseña en el
// frontend mediante una variable de entorno". Está implementado en el SERVIDOR a
// propósito: un chequeo en el cliente se saltea desactivando JavaScript o pidiendo
// el HTML con curl, y una contraseña en una var `NEXT_PUBLIC_` viaja en el bundle
// que cualquiera descarga. La experiencia es la misma; la diferencia es que esto
// sí impide entrar.
//
// No es un sistema de usuarios: es una sola contraseña compartida, el paso previo
// a los roles. No sirve para saber QUIÉN entró, solo para que no entre cualquiera.

const COOKIE = "rc_acceso";
const VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000;

export const COOKIE_ACCESO = COOKIE;

export function passwordDelSitio() {
  return String(process.env.SITE_PASSWORD || "");
}

/** Sin contraseña configurada el muro no existe y la app queda abierta. */
export function muroActivo() {
  return passwordDelSitio().length > 0;
}

const enc = new TextEncoder();

/**
 * base64url sin `Buffer`. Este módulo lo importa `proxy.js`, que puede correr en
 * un runtime donde `Buffer` no existe; `btoa` y `crypto.subtle` sí están en todos.
 */
function aBase64Url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(mensaje, clave) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(clave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return aBase64Url(await crypto.subtle.sign("HMAC", key, enc.encode(mensaje)));
}

/**
 * Comparación sin fugas de tiempo. `===` sobre strings corta en el primer byte
 * distinto, y esa diferencia de microsegundos permite adivinar un secreto byte a
 * byte. Acá se recorre todo siempre.
 */
function igualEnTiempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * ¿Es esta la contraseña? Se comparan los HMAC y no los textos: así el largo de
 * lo que manda el visitante no cambia el tiempo de respuesta.
 */
export async function passwordCorrecta(intento) {
  const real = passwordDelSitio();
  if (!real) return false;
  const [a, b] = await Promise.all([
    hmac(String(intento ?? ""), real),
    hmac(real, real),
  ]);
  return igualEnTiempoConstante(a, b);
}

/**
 * Token de sesión: vencimiento en claro y su firma. No lleva la contraseña, así
 * que robar la cookie no revela el secreto — solo da acceso hasta que vence, que
 * es lo mismo que cualquier sesión.
 *
 * La clave de firma es la contraseña: cambiarla invalida todas las sesiones
 * abiertas, que es justo lo que se espera al rotarla.
 */
export async function crearToken(ahora = Date.now()) {
  const exp = String(ahora + VIGENCIA_MS);
  return `${exp}.${await hmac(exp, passwordDelSitio())}`;
}

export async function tokenValido(token, ahora = Date.now()) {
  if (!token || typeof token !== "string") return false;
  const corte = token.indexOf(".");
  if (corte < 1) return false;
  const exp = token.slice(0, corte);
  const firma = token.slice(corte + 1);
  if (!/^\d+$/.test(exp)) return false;
  // La firma se verifica ANTES del vencimiento: si no, un token con `exp`
  // manipulado se rechazaría por vencido en vez de por falso, y el mensaje de
  // error distinto es información que no hace falta dar.
  const esperada = await hmac(exp, passwordDelSitio());
  if (!igualEnTiempoConstante(firma, esperada)) return false;
  return Number(exp) > ahora;
}

/**
 * Opciones de la cookie. HttpOnly para que ni el propio JS de la app la lea.
 *
 * `COOKIE_CROSS_SITE=1` la marca `SameSite=None`, y hace falta cuando la app se sirve
 * DENTRO de otro sitio (un iframe en otro dominio). Con `lax` el navegador la trata
 * como cookie de terceros y directamente no la guarda: el login "valida", la pantalla
 * vuelve al inicio y **no aparece ningún error**, porque del lado del servidor salió
 * todo bien. Ese silencio es lo que lo hace difícil de reconocer.
 *
 * Vacía deja el `lax` de siempre, así que NEXT y cualquier instancia que no se embeba
 * no cambian. Es política de instancia, igual que FRAME_ANCESTORS en next.config.mjs.
 *
 * `None` EXIGE `Secure`, así que en local —que es http— se ignora y se queda en `lax`.
 * Si no, el navegador descartaría la cookie y no se podría entrar ni en desarrollo.
 *
 * `SameSite=None` SOLO no alcanza, y esto se midió: Chrome 152 de escritorio bloquea
 * las cookies de terceros por defecto y la descartaba igual. Por eso va además
 * `Partitioned` (CHIPS): le dice al navegador que guarde la cookie **dentro** del sitio
 * que embebe, en un compartimento propio. Deja de ser una cookie de rastreo entre sitios
 * —que es lo que el bloqueo persigue— y sobrevive al bloqueo.
 *
 * La consecuencia de particionar, y no es un bug: la sesión iniciada dentro del iframe
 * vale SOLO ahí. Abrir la app directo en una pestaña es otro compartimento y pide la
 * contraseña de nuevo. Son dos sesiones separadas.
 *
 * Safari soporta CHIPS parcialmente; si en iPhone no entra, el cierre definitivo sigue
 * siendo servir la app desde un subdominio del sitio que la embebe, y ahí no hace falta
 * ni `None` ni `Partitioned`.
 */
export function opcionesCookie() {
  const secure = process.env.NODE_ENV === "production";
  const cruzada = String(process.env.COOKIE_CROSS_SITE || "").trim() === "1";
  return {
    name: COOKIE,
    httpOnly: true,
    sameSite: cruzada && secure ? "none" : "lax",
    // `Partitioned` sin `SameSite=None` no significa nada, por eso va con la misma
    // condición y no suelto.
    ...(cruzada && secure ? { partitioned: true } : {}),
    secure,
    path: "/",
    maxAge: Math.floor(VIGENCIA_MS / 1000),
  };
}
