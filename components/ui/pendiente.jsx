import { SectionHead } from "@/components/ui/layout";

/**
 * Marcador de vista aún no portada (F3). Deja la ruta navegable y visible en el
 * sidebar mientras se traduce la pantalla desde `proto/`.
 */
export function Pendiente({ eyebrow, title, sub, origen }) {
  return (
    <div>
      <SectionHead eyebrow={eyebrow} title={title} sub={sub} />
      <div className="rc-todo">
        Pantalla pendiente de portar (fase F3). El original está en{" "}
        <code>{origen}</code>.
      </div>
    </div>
  );
}
