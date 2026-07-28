"use client";

// Ejecuta un Server Action, avisa el resultado por toast y refresca los datos
// del servidor. Reemplaza al patrón del prototipo, donde una mutación tocaba el
// reducer, un puente la mandaba al Sheet y un evento global avisaba el resultado
// (rc:confirm → rc:sync-done): tres piezas para una operación.
//
// router.refresh() vuelve a pedir los componentes de servidor de la ruta actual;
// como cada acción invalida su etiqueta de caché, la pantalla queda con los
// datos ya escritos.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export function useAccion() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  /**
   * @param fn      función que llama al Server Action y devuelve { ok, error }
   * @param exito   { title, body } del toast de éxito (opcional)
   * @param onExito callback con el resultado, para limpiar formularios
   */
  const correr = (fn, { exito, onExito } = {}) => {
    startTransition(async () => {
      const res = await fn();
      if (!res?.ok) {
        toast.error("No se pudo guardar", res?.error || "Error inesperado");
        return;
      }
      if (exito) toast.success(exito.title, exito.body);
      onExito?.(res);
      router.refresh();
    });
  };

  return { correr, pending };
}
