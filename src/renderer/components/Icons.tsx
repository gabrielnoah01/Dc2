/**
 * Ícones em SVG, traçados na mesma grade de 24 e com a mesma espessura.
 *
 * Substituem os emoji que estavam espalhados pela interface: emoji é
 * renderizado pela fonte do sistema, então muda de forma e de cor entre
 * máquinas, não acompanha a cor do texto e quase sempre parece grande demais
 * ao lado de um rótulo.
 */

type Props = {
  size?: number;
  className?: string;
};

function Svg({ size = 16, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const Icon = {
  settings: (props: Props) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  ),
  mic: (props: Props) => (
    <Svg {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
    </Svg>
  ),
  micOff: (props: Props) => (
    <Svg {...props}>
      <path d="M15 9V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1" />
      <path d="M5 10a7 7 0 0 0 10.7 6M19 10v1M12 19v3" />
      <path d="m3 3 18 18" />
    </Svg>
  ),
  headphones: (props: Props) => (
    <Svg {...props}>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <path d="M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z" />
    </Svg>
  ),
  headphonesOff: (props: Props) => (
    <Svg {...props}>
      <path d="M4 15v-3a8 8 0 0 1 12.2-6.8M20 12v3" />
      <path d="M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z" />
      <path d="m3 3 18 18" />
    </Svg>
  ),
  screen: (props: Props) => (
    <Svg {...props}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Svg>
  ),
  screenShare: (props: Props) => (
    <Svg {...props}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4M12 12V7M9.5 9.5 12 7l2.5 2.5" />
    </Svg>
  ),
  paperclip: (props: Props) => (
    <Svg {...props}>
      <path d="M21.4 11.1 12.3 20a5.5 5.5 0 0 1-7.8-7.8l9.2-9.1a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.1a1.8 1.8 0 0 1-2.6-2.6l8.5-8.4" />
    </Svg>
  ),
  copy: (props: Props) => (
    <Svg {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  ),
  check: (props: Props) => (
    <Svg {...props}>
      <path d="m4 12.5 5 5L20 6.5" />
    </Svg>
  ),
  plus: (props: Props) => (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  enter: (props: Props) => (
    <Svg {...props}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5M15 12H3" />
    </Svg>
  ),
  exit: (props: Props) => (
    <Svg {...props}>
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Svg>
  ),
  chevron: (props: Props) => (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  shield: (props: Props) => (
    <Svg {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Svg>
  ),
  wifi: (props: Props) => (
    <Svg {...props}>
      <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0" />
      <circle cx="12" cy="19.5" r="1" fill="currentColor" />
    </Svg>
  ),
  globe: (props: Props) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
    </Svg>
  ),
  users: (props: Props) => (
    <Svg {...props}>
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 20v-2a4 4 0 0 0-3-3.9" />
    </Svg>
  ),
  chat: (props: Props) => (
    <Svg {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
    </Svg>
  ),
  image: (props: Props) => (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Svg>
  ),
  send: (props: Props) => (
    <Svg {...props}>
      <path d="M21 3 3 10.5l7 3 3 7z" />
      <path d="M21 3 10 14" />
    </Svg>
  ),
  trash: (props: Props) => (
    <Svg {...props}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
    </Svg>
  ),
};
