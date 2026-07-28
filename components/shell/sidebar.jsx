"use client";

// Sidebar. Antes navegaba despachando { type: "NAVIGATE", view } al reducer y el
// hash de la URL se sincronizaba después (RouterSync). Ahora son links reales:
// la ruta es la fuente de verdad y el estado activo sale de usePathname.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";

// `match` define qué rutas dejan el ítem activo, no solo su propio href:
// /matriz cuelga de Dashboard, /impacto/factores de Impacto, etc.
const ITEMS = [
  { href: "/", label: "Inicio", icon: "home", match: (p) => p === "/" },
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", match: (p) => p.startsWith("/dashboard") || p.startsWith("/matriz") },
  { href: "/impacto", label: "Impacto", icon: "eco", match: (p) => p.startsWith("/impacto") },
  { href: "/registrar", label: "Registrar", icon: "edit", match: (p) => p.startsWith("/registrar") },
  { href: "/medidores", label: "Medidores", icon: "speed", match: (p) => p.startsWith("/medidores") },
  { href: "/configuracion", label: "Configuración", icon: "settings", match: (p) => p.startsWith("/configuracion") },
];

export function Sidebar({ collapsed, onToggle }) {
  const pathname = usePathname() || "/";

  return (
    <aside className={"rc-sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="rc-sidebar-head">
        {!collapsed && (
          <div className="rc-sidebar-brand">
            <span className="rc-sidebar-logo">R</span>
            <span className="rc-sidebar-brand-text">Recylink</span>
          </div>
        )}
        <button
          className="rc-sidebar-toggle"
          onClick={onToggle}
          title={collapsed ? "Expandir menú" : "Colapsar menú"}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        >
          <Icon name={collapsed ? "arrow_forward" : "arrow_back"} size={16} />
        </button>
      </div>

      <nav className="rc-sidebar-nav">
        {ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={"rc-sidebar-item" + (it.match(pathname) ? " active" : "")}
            data-tooltip={it.label}
            aria-current={it.match(pathname) ? "page" : undefined}
          >
            <span className="rc-sidebar-item-ico">
              <Icon name={it.icon} size={18} />
            </span>
            <span className="rc-sidebar-item-label">{it.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
