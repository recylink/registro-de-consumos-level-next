// Los Server Actions devuelven un resultado, no lanzan. Una excepción cruzando
// el límite servidor→cliente llega al navegador como "An error occurred in the
// Server Components render" sin el mensaje real (Next lo oculta en producción a
// propósito), y estos errores son justamente los que el usuario necesita leer:
// "backend no configurado", "carpeta sin configurar", "registro no editable".

export async function run(fn) {
  try {
    const data = await fn();
    return { ok: true, ...(data && typeof data === "object" ? data : { data }) };
  } catch (err) {
    console.error("[rc:action]", err);
    return { ok: false, error: err.message || "Error inesperado" };
  }
}
