// Placeholder de andamiaje (F0). La pantalla Inicio real se porta en F3 desde
// `proto/landing.jsx`; el shell y las rutas se construyen en F2.
export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1 className="prt-h1">Registro de Consumos</h1>
      <p className="prt-body" style={{ color: "var(--rl-gray-600)" }}>
        Andamiaje Next.js listo. Tokens del design system y estilos del
        prototipo cargados desde <code>app/globals.css</code>.
      </p>
      <p className="prt-body" style={{ color: "var(--rl-gray-600)" }}>
        Siguiente: data layer server-side (F1) y rutas del App Router (F2).
      </p>
    </main>
  );
}
