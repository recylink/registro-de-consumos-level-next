import Link from "next/link";
import { Icon } from "@/components/icons";
import { Chip, SectionHead } from "@/components/ui/layout";

export const metadata = { title: "Registrar consumo" };

// Hub de registro. Portado de RegisterHubView (proto/shell.jsx): las tarjetas
// eran <button> que despachaban NAVIGATE, ahora son links reales, así que la
// pantalla es un componente de servidor sin JavaScript propio en el cliente.

const OPCIONES = [
  {
    href: "/registrar/manual",
    kind: "primary",
    icon: "edit",
    title: "Registrar a mano",
    desc: "Un consumo a la vez con un formulario corto. ~1 min.",
    chips: [],
  },
  {
    href: "/registrar/subir",
    kind: "alt",
    icon: "cloud_upload",
    title: "Subir documento",
    desc: "Sube PDFs o Excel de tus proveedores. Rápido y automático.",
    chips: ["Enel", "Aguas Andinas", "Iconstruye"],
  },
  {
    href: "/registrar/foto",
    kind: "alt",
    icon: "photo_camera",
    title: "Tomar foto",
    desc: "Captura medidor o documento. Datos se completan luego desde la cola o el Sheet.",
    chips: ["Móvil", "Drive", "Diferido"],
  },
];

export default function RegistrarPage() {
  return (
    <div>
      <SectionHead
        eyebrow="Registrar consumo"
        title="¿Cómo quieres registrar?"
        sub="Ingresa un consumo con el formulario, o sube un documento de tu proveedor y extraemos los datos por ti."
      />
      <div className="rc-register-hub">
        {OPCIONES.map((o) => (
          <Link key={o.href} href={o.href} className={"rc-register-card " + o.kind}>
            <span className={"rc-register-card-ico" + (o.kind === "alt" ? " alt" : "")}>
              <Icon name={o.icon} size={28} />
            </span>
            <span className="rc-register-card-title">{o.title}</span>
            <span className="rc-register-card-desc">{o.desc}</span>
            {o.chips.length > 0 && (
              <span className="rc-register-card-chips">
                {o.chips.map((c) => (
                  <Chip key={c} size="sm">{c}</Chip>
                ))}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
