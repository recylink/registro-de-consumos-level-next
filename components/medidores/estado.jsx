"use client";

// Estado del módulo Medidores en el cliente + guardado automático.
//
// Es la única vista con edición celda por celda: una lectura por medidor y mes,
// más precios y documentos. Guardar en cada tecla no sirve (el Apps Script
// reescribe las tres hojas por escritura y serializa con un lock de 30s), así
// que se replica lo del prototipo: el módulo completo vive en memoria y se
// escribe con 900ms de debounce.
//
// Diferencias con el prototipo:
//   - el resultado del guardado se avisa (allá un fallo era un console.error y
//     el usuario seguía escribiendo creyendo que se guardaba);
//   - los guardados se encolan en vez de solaparse;
//   - `flush()` permite forzar la escritura antes de abrir el reporte, que lee
//     los datos del servidor.
//
// El estado del servidor solo siembra el inicial: desde ahí manda el cliente,
// porque cada tecla lo modifica. Al navegar fuera y volver, la página vuelve a
// leer la planilla (la acción invalida la etiqueta de caché).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { saveMedidoresAction } from "@/app/actions/medidores";
import { useToast } from "@/components/ui/toast";
import * as med from "@/lib/domain/medidores";

const DEBOUNCE_MS = 900;

const MedidoresContext = createContext(null);

const slice = (M) => ({ meters: M.meters, readings: M.readings, prices: M.prices, docs: M.docs });

export function MedidoresProvider({ inicial, children }) {
  const toast = useToast();
  const [M, setM] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const timer = useRef(null);
  const cola = useRef(Promise.resolve());
  // Lo último que se sabe escrito en la planilla. Arranca en el estado que vino
  // del servidor, así abrir la pantalla no dispara una escritura.
  const escrito = useRef(JSON.stringify(slice(inicial)));
  const porEscribir = useRef(null);

  const escribir = useCallback(() => {
    const datos = porEscribir.current;
    if (!datos) return cola.current;
    porEscribir.current = null;
    const json = JSON.stringify(datos);

    cola.current = cola.current.then(async () => {
      setGuardando(true);
      const res = await saveMedidoresAction(datos);
      setGuardando(false);
      if (res?.ok) {
        escrito.current = json;
        return;
      }
      // Se deja pendiente: el próximo cambio (o un flush) lo reintenta.
      if (!porEscribir.current) porEscribir.current = datos;
      toast.error("No se pudo guardar en la planilla", res?.error || "Error inesperado");
    });
    return cola.current;
  }, [toast]);

  useEffect(() => {
    const datos = slice(M);
    if (JSON.stringify(datos) === escrito.current) return;
    porEscribir.current = datos;
    clearTimeout(timer.current);
    timer.current = setTimeout(escribir, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [M, escribir]);

  /** Escribe ya lo pendiente y espera. Para antes de leer los datos del servidor. */
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    return escribir();
  }, [escribir]);

  // Cada acción es el transform puro de lib/domain/medidores aplicado al estado.
  const api = {
    M,
    guardando,
    flush,
    setReading: (args) => setM((m) => med.setReading(m, args)),
    setPrice: (args) => setM((m) => med.setPrice(m, args)),
    setDoc: (args) => setM((m) => med.setDoc(m, args)),
    addMeter: (args) => setM((m) => med.addMeter(m, args)),
    editMeter: (id, patch) => setM((m) => med.editMeter(m, id, patch)),
    toggleMeter: (id) => setM((m) => med.toggleMeter(m, id)),
  };

  return <MedidoresContext.Provider value={api}>{children}</MedidoresContext.Provider>;
}

export function useMedidores() {
  const ctx = useContext(MedidoresContext);
  if (!ctx) throw new Error("useMedidores fuera de MedidoresProvider");
  return ctx;
}
