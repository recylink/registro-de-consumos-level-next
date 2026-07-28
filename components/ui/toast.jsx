"use client";

// Toast. En el prototipo vivía en el reducer global (`state.toast` + acciones
// TOAST/SHOW y TOAST/HIDE) y se auto-ocultaba con un efecto en el provider. Acá
// es un contexto propio: nada más de la app necesita saber que existe.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";

const AUTO_HIDE_MS = 4500;

const ToastContext = createContext(null);

const ICONS = { success: "check", error: "close", warning: "warning", info: "info" };

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const hide = useCallback(() => setToast(null), []);

  const show = useCallback((t) => {
    // El id fuerza que dos toasts iguales seguidos reinicien el temporizador.
    setToast({ kind: "info", ...t, id: Symbol("toast") });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(hide, AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [toast, hide]);

  const api = useMemo(
    () => ({
      show,
      hide,
      success: (title, body) => show({ kind: "success", title, body }),
      error: (title, body) => show({ kind: "error", title, body }),
      warning: (title, body) => show({ kind: "warning", title, body }),
      info: (title, body) => show({ kind: "info", title, body }),
    }),
    [show, hide],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && <ToastHost toast={toast} onHide={hide} />}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast fuera de ToastProvider");
  return ctx;
}

function ToastHost({ toast, onHide }) {
  return (
    <div className="prt-toast-host">
      <div className={"prt-toast " + toast.kind} role="status">
        <span className="ico">
          <Icon name={ICONS[toast.kind] || "info"} size={18} />
        </span>
        <div className="prt-grow">
          <div className="title">{toast.title}</div>
          {toast.body && <div className="body">{toast.body}</div>}
          {toast.undoAction && (
            <div className="actions">
              <button
                className="undo"
                onClick={() => {
                  toast.undoAction();
                  onHide();
                }}
              >
                Deshacer
              </button>
            </div>
          )}
        </div>
        <button className="close" onClick={onHide}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
