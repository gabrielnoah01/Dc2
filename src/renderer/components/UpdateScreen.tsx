import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '@shared/ipc';
import { Logo } from './Logo';
import { Icon } from './Icons';

/**
 * Tela cheia de "baixando atualização".
 *
 * Só aparece com o app ocioso (fora de uma sala) e enquanto o download está em
 * curso: é o único momento em que ocupar a tela inteira ajuda em vez de
 * atrapalhar. Quem está no meio de uma conversa continua vendo apenas o cartão
 * do canto, e quem está aqui pode dispensar a tela a qualquer momento — o
 * download segue em segundo plano de qualquer forma.
 */
export function UpdateScreen({ status }: { status: UpdateStatus }) {
  const [dismissed, setDismissed] = useState(false);
  const downloading = status.state === 'downloading';

  // Um download novo (outra versão) merece voltar a aparecer.
  const version = status.state === 'downloading' ? status.version : undefined;
  useEffect(() => setDismissed(false), [version]);

  if (!downloading || dismissed) return null;

  const percent = clamp(status.percent);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-ink-950/95 backdrop-blur-xl animate-fade-in">
      <Aurora percent={percent} />

      <div className="relative z-10 w-full max-w-sm px-8 text-center">
        <div className="relative mx-auto grid h-28 w-28 place-items-center">
          <Ring percent={percent} />
          <div className="absolute inset-0 -z-10 animate-breathe rounded-full bg-accent/20 blur-2xl" />
          <Logo size={44} animated />
        </div>

        <p className="mt-7 text-lg font-medium text-slate-100">Baixando atualização</p>
        <p className="mt-1 text-xs text-slate-500">
          {status.version ? `Versão ${status.version}` : 'Nova versão do Only'}
        </p>

        <div className="relative mt-6 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
          <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${percent}%` }}>
            <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] tabular-nums text-slate-500">
          <span>{describeSize(status)}</span>
          <span>{describeRate(status)}</span>
        </div>

        <p className="mt-8 text-[11px] leading-relaxed text-slate-600">
          Host e convidado precisam da mesma versão para conversar — por isso vale esperar.
          A instalação acontece no próximo fechamento do app.
        </p>

        <button className="btn-ghost mt-5 gap-1.5 px-4 py-2 text-xs" onClick={() => setDismissed(true)}>
          <Icon.chevron size={13} />
          Continuar usando o Only
        </button>
      </div>
    </div>
  );
}

/** Anel de progresso desenhado em SVG, para o número não ser a única pista. */
function Ring({ percent }: { percent: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 112 112">
      <circle cx="56" cy="56" r={radius} className="fill-none stroke-ink-800" strokeWidth="3" />
      <circle
        cx="56"
        cy="56"
        r={radius}
        className="fill-none stroke-accent transition-[stroke-dashoffset] duration-500 ease-out"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)}
      />
    </svg>
  );
}

/**
 * Fundo que reage ao progresso: o brilho cresce conforme o download avança.
 * É decoração, mas é a decoração que faz a espera parecer que anda.
 */
function Aurora({ percent }: { percent: number }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className="absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl transition-all duration-1000"
        style={{ opacity: 0.25 + (percent / 100) * 0.55, transform: `translate(-50%, -50%) scale(${0.7 + percent / 200})` }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_35%,rgb(0_0_0/0.55))]" />
    </div>
  );
}

function describeSize(status: Extract<UpdateStatus, { state: 'downloading' }>): string {
  if (status.transferred === undefined || !status.total) return 'preparando…';
  return `${formatBytes(status.transferred)} de ${formatBytes(status.total)}`;
}

function describeRate(status: Extract<UpdateStatus, { state: 'downloading' }>): string {
  const speed = status.speed ? `${formatBytes(status.speed)}/s` : '';
  const left = remaining(status);
  return [speed, left].filter(Boolean).join(' · ') || `${clamp(status.percent)}%`;
}

/** Estimativa grosseira de tempo: melhor um "≈2 min" do que um número sem contexto. */
function remaining(status: Extract<UpdateStatus, { state: 'downloading' }>): string {
  if (!status.speed || !status.total || status.transferred === undefined) return '';
  const seconds = Math.round((status.total - status.transferred) / status.speed);
  if (seconds <= 0) return '';
  if (seconds < 60) return `≈${seconds}s`;
  return `≈${Math.round(seconds / 60)} min`;
}

function clamp(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
