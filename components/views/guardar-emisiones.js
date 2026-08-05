"use client";

// Guardado de emisiones desde las vistas de Factores y Metas.
//
// Las dos pantallas tienen el mismo patrón: el objeto de emisiones vive en estado
// local y cada cambio lo guarda. Lo que se manda es el patch —la diferencia contra
// el último guardado confirmado—, no el objeto completo; mandarlo completo hacía que
// la hoja quedara igual a la copia de esta pestaña, borrando lo que hubiera escrito
// otra sesión. Ver lib/domain/emisiones-patch.js.
//
// `confirmado` solo avanza cuando el servidor responde ok. Si un guardado falla, el
// estado local ya cambió pero la referencia no, así que el próximo diff vuelve a
// incluir lo que faltaba: se recupera solo, sin reintentos explícitos.

import { useRef } from "react";
import { saveEmissionsPatchAction } from "@/app/actions/config";
import { useAccion } from "@/components/use-accion";
import { diffEmisiones } from "@/lib/domain/emisiones-patch";

export function useGuardarEmisiones(inicial) {
  const { correr, pending } = useAccion();
  const confirmado = useRef(inicial);

  /**
   * @param siguiente  el objeto de emisiones completo, tal como quedó en la UI
   * @param opts       { exito, onExito } — se pasan tal cual a `correr`
   *
   * El patch vacío NO se corta acá a propósito: la Server Action no escribe nada,
   * pero el toast de éxito, el `onExito` y el refresh siguen ocurriendo igual que
   * antes. Guardar sin cambios se sigue viendo como guardar.
   */
  const guardarEmisiones = (siguiente, { exito, onExito } = {}) => {
    const patch = diffEmisiones(confirmado.current, siguiente);
    correr(() => saveEmissionsPatchAction(patch), {
      exito,
      onExito: (res) => {
        confirmado.current = siguiente;
        onExito?.(res);
      },
    });
  };

  return { guardarEmisiones, pending };
}
