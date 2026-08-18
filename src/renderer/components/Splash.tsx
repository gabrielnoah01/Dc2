import { useEffect, useState } from 'react';
import { APP_NAME } from '@shared/constants';
import { Logo } from './Logo';

/**
 * Abertura do app.
 *
 * Existe por um motivo prático: as preferências chegam do processo principal
 * um instante depois da primeira renderização. Sem isto, a tela inicial pisca
 * com os campos vazios e depois preenche sozinha — parece defeito.
 *
 * Fica no ar por um tempo mínimo mesmo quando tudo carrega instantaneamente:
 * um splash que aparece e some em 40ms incomoda mais do que ajuda.
 */
export function Splash({ ready }: { ready: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const minimum = window.setTimeout(() => setLeaving(true), 450);
    return () => window.clearTimeout(minimum);
  }, [ready]);

  useEffect(() => {
    if (!leaving) return;
    // Espera a transição de saída terminar antes de tirar do DOM.
    const timer = window.setTimeout(() => setGone(true), 320);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (gone) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink-950 transition-all duration-300 ${
        leaving ? 'pointer-events-none scale-105 opacity-0' : 'opacity-100'
      }`}
    >
      <div className="relative">
        {/* Halo por trás do símbolo. */}
        <div className="absolute inset-0 -z-10 animate-breathe rounded-full bg-accent/25 blur-3xl" />
        <Logo size={88} animated />
      </div>

      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{APP_NAME}</h1>
        <p className="text-xs text-slate-500">conversa direta, sem servidor no meio</p>
      </div>

      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-ink-700">
        <div className="h-full w-1/3 animate-shimmer rounded-full bg-accent" />
      </div>
    </div>
  );
}
