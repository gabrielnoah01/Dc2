/**
 * O "O" do Only: um anel com um recorte, desenhado em SVG para escalar de
 * 16px (barra de título) a 96px (abertura) sem borrar.
 */
export function Logo({ size = 64, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={animated ? 'animate-breathe' : undefined}
      aria-hidden
    >
      <defs>
        <linearGradient id="only-ring" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7aa2ff" />
          <stop offset="1" stopColor="#3f6ae0" />
        </linearGradient>
      </defs>

      <circle
        cx="32"
        cy="32"
        r="22"
        stroke="url(#only-ring)"
        strokeWidth="9"
        strokeLinecap="round"
        // O recorte no anel é o que faz o símbolo virar uma marca em vez de
        // um círculo qualquer.
        strokeDasharray="118 20"
        transform="rotate(-45 32 32)"
      />
      <circle cx="32" cy="32" r="5" fill="url(#only-ring)" />
    </svg>
  );
}
