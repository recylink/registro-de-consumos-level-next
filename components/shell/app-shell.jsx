"use client";

// Chrome de la app: sidebar + contenedor de contenido. Vive en el layout, así
// que sobrevive a la navegación entre rutas y no se re-monta (el estado de
// colapso y el toast no se pierden al cambiar de pantalla).
//
// El `Shell` del prototipo además elegía qué vista renderizar (ViewSwitcher);
// eso ahora lo hace el router.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { VersionBanner } from "@/components/shell/version-banner";
import { ToastProvider } from "@/components/ui/toast";

const LS_KEY = "rcSidebarCollapsed";

// Rutas que se dibujan sin el chrome de la app. `/acceso` es la única: mostrar el
// sidebar detrás del muro de contraseña insinuaría que hay algo navegable, y sus
// links llevarían de vuelta al muro.
//
// La alternativa era mover todas las pantallas a un route group `(app)` con su
// propio layout y dejar `/acceso` afuera. Es más idiomático, pero mueve 17
// archivos para una excepción; si aparecen más pantallas sin chrome, conviene.
const SIN_CHROME = ["/acceso"];

export function AppShell({ children, conMuro }) {
  // Arranca expandido y se corrige tras montar. No se lee localStorage en el
  // primer render porque el servidor no lo tiene y la hidratación fallaría; una
  // cookie evitaría el ajuste, pero volvería dinámica toda ruta estática.
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(LS_KEY);
      if (v === "1") setCollapsed(true);
      else if (v === "0") setCollapsed(false);
      else setCollapsed(window.innerWidth < 900); // por defecto, colapsado en pantallas angostas
    } catch {
      // Modo privado o storage bloqueado: queda el valor por defecto.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(LS_KEY, collapsed ? "1" : "0");
    } catch {
      // Sin persistencia; el colapso sigue funcionando en la sesión.
    }
  }, [collapsed, ready]);

  // Al cambiar de ruta, el contenido vuelve arriba. Es un contenedor con scroll
  // propio, así que el scroll restoration del router no lo cubre.
  useEffect(() => {
    document.querySelector(".prt-host-content")?.scrollTo({ top: 0 });
  }, [pathname]);

  // El ToastProvider se conserva incluso sin chrome: la pantalla de acceso avisa
  // por toast si la contraseña no va.
  if (SIN_CHROME.includes(pathname)) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <div className={"prt-app " + (collapsed ? "sidebar-collapsed" : "sidebar-expanded")}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} conMuro={conMuro} />
        <div className="prt-host-content">{children}</div>
        <VersionBanner />
      </div>
    </ToastProvider>
  );
}
