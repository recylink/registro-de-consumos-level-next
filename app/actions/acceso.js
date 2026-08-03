"use server";

import { cookies, headers } from "next/headers";
import { run } from "@/lib/result";
import {
  COOKIE_ACCESO,
  crearToken,
  muroActivo,
  opcionesCookie,
  passwordCorrecta,
} from "@/lib/auth/acceso";

// Ingreso al sitio. La contraseña se compara en el servidor y nunca sale de acá:
// lo único que vuelve al navegador es una cookie HttpOnly con un token firmado.

// Freno de fuerza bruta, POR IP.
//
// La primera versión llevaba un solo contador global, y eso convertía el freno en
// un ataque: cualquiera —o un compañero con dedos torpes— gastaba los 10 intentos
// y dejaba afuera a todo el equipo por cinco minutos. Con una contraseña
// compartida no hay identidad de usuario, así que la IP es lo único que separa a
// un visitante de otro.
//
// Es por instancia y se pierde al reciclarse la función, así que no es un límite
// duro: sirve contra el intento automatizado obvio, no contra alguien con paciencia
// y varias IP. Un límite real necesita almacenamiento compartido (Redis del
// Marketplace) o el rate limiting del firewall de Vercel.
const intentos = new Map();
const VENTANA_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 10;
const MAX_IPS = 5000; // techo de memoria: la instancia puede vivir horas

function limpiar(ahora) {
  for (const [k, v] of intentos) {
    const vivos = v.filter((t) => ahora - t < VENTANA_MS);
    if (vivos.length) intentos.set(k, vivos);
    else intentos.delete(k);
  }
}

function demasiadosIntentos(clave, ahora = Date.now()) {
  const previos = (intentos.get(clave) || []).filter((t) => ahora - t < VENTANA_MS);
  if (previos.length) intentos.set(clave, previos);
  else intentos.delete(clave);
  return previos.length >= MAX_INTENTOS;
}

function anotarIntento(clave, ahora = Date.now()) {
  if (intentos.size > MAX_IPS) limpiar(ahora);
  const previos = intentos.get(clave) || [];
  previos.push(ahora);
  intentos.set(clave, previos);
}

/**
 * IP del visitante. En Vercel llega en `x-forwarded-for` como lista, donde el
 * primer valor es el cliente. No es infalsificable —quien controle el header puede
 * rotarla— pero para el intento automatizado común alcanza, y evita que un
 * visitante bloquee a los demás.
 */
async function ipDe() {
  const h = await headers();
  const xff = h.get("x-forwarded-for") || "";
  const primera = xff.split(",")[0].trim();
  return primera || h.get("x-real-ip") || "sin-ip";
}

export async function ingresarAction(formData) {
  return run(async () => {
    if (!muroActivo()) {
      // Sin contraseña configurada no hay nada que validar; se responde ok para
      // que la pantalla no quede trabada si alguien llega a /acceso.
      return { entro: true, sinMuro: true };
    }

    const clave = await ipDe();
    if (demasiadosIntentos(clave)) {
      throw new Error("Demasiados intentos. Esperá unos minutos y volvé a probar.");
    }

    const password = formData.get("password");
    if (!(await passwordCorrecta(password))) {
      anotarIntento(clave);
      // Mensaje único: no se distingue "vacía" de "incorrecta".
      throw new Error("Contraseña incorrecta.");
    }

    const store = await cookies();
    store.set({ ...opcionesCookie(), value: await crearToken() });
    return { entro: true };
  });
}

export async function salirAction() {
  return run(async () => {
    const store = await cookies();
    store.set({ ...opcionesCookie(), name: COOKIE_ACCESO, value: "", maxAge: 0 });
    return { salio: true };
  });
}
