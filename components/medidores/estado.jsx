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
//
// Sobre la pérdida de datos que motivó el estado `fase`: con solo un booleano
// `guardando`, una escritura pendiente se perdía en silencio en tres casos —
// navegar fuera (o cambiar de pantalla) dentro de la ventana de debounce, cerrar
// o recargar la pestaña, y un guardado fallido que nadie reintentaba porque el
// reintento dependía de que el usuario siguiera escribiendo. Ahora la fase es
// explícita y observable por la UI, el desmontaje y el cierre de pestaña fuerzan
// la escritura, y los fallos se reintentan solos con espera creciente.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { saveMedidoresAction } from "@/app/actions/medidores";
import { useToast } from "@/components/ui/toast";
import * as med from "@/lib/domain/medidores";

const DEBOUNCE_MS = 900;

// Esperas entre reintentos de un guardado fallido. Después del último, la fase
// queda en "error" y el reintento pasa a ser manual (botón de la UI).
const REINTENTOS_MS = [2000, 6000, 15000];

const MedidoresContext = createContext(null);

const slice = (M) => ({ meters: M.meters, readings: M.readings, prices: M.prices, docs: M.docs });

export function MedidoresProvider({ inicial, children }) {
  const toast = useToast();
  const [M, setM] = useState(inicial);

  /**
   * fase: limpio | pendiente | guardando | guardado | error
   * ts:   momento del último guardado confirmado (para "Guardado 14:32")
   */
  const [estado, setEstado] = useState({ fase: "limpio", ts: null, error: null });

  const timer = useRef(null);
  const reintento = useRef(null);
  const intentos = useRef(0);
  const cola = useRef(Promise.resolve());
  // Lo último que se sabe escrito en la planilla. Arranca en el estado que vino
  // del servidor, así abrir la pantalla no dispara una escritura.
  const escrito = useRef(JSON.stringify(slice(inicial)));
  const porEscribir = useRef(null);
  // El toast de fallo se muestra una vez por racha de errores, no en cada
  // reintento: si no, escribir con la planilla caída llena la pantalla de avisos.
  const avisado = useRef(false);

  const escribir = useCallback(() => {
    const datos = porEscribir.current;
    if (!datos) return cola.current;
    porEscribir.current = null;
    const json = JSON.stringify(datos);

    cola.current = cola.current.then(async () => {
      setEstado((e) => ({ ...e, fase: "guardando", error: null }));
      const res = await saveMedidoresAction(datos);

      if (res?.ok) {
        escrito.current = json;
        intentos.current = 0;
        avisado.current = false;
        // Si mientras se escribía llegaron cambios nuevos, la fase la fija el
        // efecto que los detecta; acá solo se confirma lo que sí quedó guardado.
        setEstado({ fase: porEscribir.current ? "pendiente" : "guardado", ts: Date.now(), error: null });
        return;
      }

      // Se deja pendiente y se reintenta solo: el dato ya digitado no se pierde
      // por un error de red.
      if (!porEscribir.current) porEscribir.current = datos;
      const error = res?.error || "Error inesperado";
      setEstado((e) => ({ ...e, fase: "error", error }));

      const espera = REINTENTOS_MS[intentos.current];
      if (espera != null) {
        intentos.current += 1;
        clearTimeout(reintento.current);
        reintento.current = setTimeout(() => escribir(), espera);
      }
      if (!avisado.current) {
        avisado.current = true;
        toast.error("No se pudo guardar en la planilla", error + " — se reintenta solo.");
      }
    });
    return cola.current;
  }, [toast]);

  useEffect(() => {
    const datos = slice(M);
    if (JSON.stringify(datos) === escrito.current) return;
    porEscribir.current = datos;
    setEstado((e) => (e.fase === "guardando" ? e : { ...e, fase: "pendiente" }));
    clearTimeout(timer.current);
    timer.current = setTimeout(escribir, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [M, escribir]);

  /** Escribe ya lo pendiente y espera. Para antes de leer los datos del servidor. */
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    clearTimeout(reintento.current);
    intentos.current = 0;
    return escribir();
  }, [escribir]);

  // Salir de la pantalla no debe descartar lo que estaba en la ventana de
  // debounce: al desmontar se dispara la escritura pendiente. La navegación del
  // router no corta el request en vuelo, así que alcanza a completarse.
  //
  // El ref existe para que este efecto tenga dependencias vacías: si dependiera
  // de `escribir`, cualquier cambio de identidad de esa función correría el
  // cleanup y escribiría antes de tiempo.
  const escribirRef = useRef(escribir);
  escribirRef.current = escribir;
  useEffect(() => {
    return () => {
      if (porEscribir.current) escribirRef.current();
    };
  }, []);

  // Cerrar o recargar la pestaña sí corta todo. Se intenta escribir y, si queda
  // algo pendiente, el navegador pregunta antes de salir.
  useEffect(() => {
    const alSalir = (e) => {
      if (!porEscribir.current) return;
      escribir();
      e.preventDefault();
      e.returnValue = "";
    };
    const alOcultar = () => {
      if (porEscribir.current) escribir();
    };
    window.addEventListener("beforeunload", alSalir);
    document.addEventListener("visibilitychange", alOcultar);
    return () => {
      window.removeEventListener("beforeunload", alSalir);
      document.removeEventListener("visibilitychange", alOcultar);
    };
  }, [escribir]);

  // Cada acción es el transform puro de lib/domain/medidores aplicado al estado.
  const api = {
    M,
    estado,
    // Compatibilidad con la UI que solo quería saber si hay una escritura en
    // curso.
    guardando: estado.fase === "guardando",
    pendiente: estado.fase === "pendiente" || estado.fase === "error",
    flush,
    reintentar: flush,
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
