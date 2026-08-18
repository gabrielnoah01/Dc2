import { APP_NAME } from '@shared/constants';
import { Logo } from './Logo';

/**
 * Barra de título própria.
 *
 * A do Windows é cinza e destoa de tudo. Escondemos ela e mantemos só os
 * botões nativos (minimizar/maximizar/fechar), que o Electron redesenha na
 * nossa cor — assim a janela continua se comportando como janela.
 *
 * `app-region: drag` é o que devolve o arrastar; sem isso a janela ficaria
 * presa no lugar.
 */
export function TitleBar() {
  return (
    <header
      className="flex h-8 shrink-0 select-none items-center gap-2 border-b border-ink-800 bg-ink-900 px-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <Logo size={14} />
      <span className="text-[11px] font-medium tracking-wide text-slate-500">{APP_NAME}</span>
    </header>
  );
}
