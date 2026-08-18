import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@shared/ipc';
import { Logo } from './Logo';
import { Icon } from './Icons';

/**
 * Cartão de atualização, no canto.
 *
 * Fica flutuando em vez de ocupar a tela: baixar leva minutos, e travar o app
 * nesse tempo seria pior do que a atualização em si. Só o passo final pede
 * atenção, porque exige reiniciar.
 *
 * "Nenhuma atualização" e "sem servidor configurado" não aparecem — não são
 * problema de quem está usando.
 */
export function UpdateBanner({ status }: { status: UpdateStatus }) {
  const visible = status.state === 'downloading' || status.state === 'ready';
  const [mounted, setMounted] = useState(false);

  // Um quadro de atraso para a animação de entrada realmente acontecer.
  useEffect(() => {
    if (!visible) return setMounted(false);
    const timer = window.setTimeout(() => setMounted(true), 20);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  const downloading = status.state === 'downloading';
  const percent = downloading ? status.percent : 100;

  return (
    <div
      className={`fixed bottom-4 right-4 z-40 w-80 rounded-xl bg-ink-800/95 p-4 shadow-pop ring-1 ring-ink-600 backdrop-blur-md transition-all duration-300 ${
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {downloading && (
            <div className="absolute inset-0 -z-10 animate-breathe rounded-full bg-accent/25 blur-lg" />
          )}
          <Logo size={30} animated={downloading} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100">
            {downloading ? 'Baixando atualização' : 'Atualização pronta'}
            {status.version && (
              <span className="ml-1.5 font-normal text-slate-500">{status.version}</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            {downloading
              ? describeProgress(status)
              : 'Host e convidado precisam da mesma versão para conversar.'}
          </p>
        </div>

        {!downloading && <Icon.check size={16} className="mt-0.5 shrink-0 text-speak" />}
      </div>

      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-ink-950">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
        {/* Brilho correndo por cima da parte já baixada. */}
        {downloading && (
          <div
            className="absolute inset-y-0 left-0 overflow-hidden"
            style={{ width: `${percent}%` }}
          >
            <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <span className="text-[11px] tabular-nums text-slate-500">{percent}%</span>
        {!downloading && (
          <button
            className="btn-primary ml-auto gap-1.5 px-3 py-1.5 text-xs"
            onClick={() => void window.only.installUpdate()}
          >
            <Icon.enter size={13} />
            Reiniciar e atualizar
          </button>
        )}
      </div>
    </div>
  );
}

function describeProgress(status: Extract<UpdateStatus, { state: 'downloading' }>): string {
  const parts: string[] = [];
  if (status.transferred !== undefined && status.total) {
    parts.push(`${formatBytes(status.transferred)} de ${formatBytes(status.total)}`);
  }
  if (status.speed) parts.push(`${formatBytes(status.speed)}/s`);

  // Sem números ainda: o download acabou de começar.
  return parts.length > 0 ? parts.join(' · ') : 'preparando…';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
