import { useState } from 'react';
import type { Participant } from '@shared/protocol';
import { formatBitrate, type NetGrade, type NetHealth } from '../webrtc/netHealth';
import { participantName } from '../state/store';
import { Icon } from './Icons';

/**
 * Termômetro da rede, no rodapé da sala.
 *
 * Fechado é só uma bolinha colorida com a banda em uso — o suficiente para
 * quem está conversando notar que a queda não foi culpa do app. Aberto, mostra
 * pessoa por pessoa: quando só um está no vermelho, o problema é dele, e essa
 * distinção evita meia hora de gente reiniciando roteador à toa.
 */
export function NetworkHealth({
  health,
  participants,
}: {
  health: NetHealth;
  participants: Participant[];
}) {
  const [open, setOpen] = useState(false);

  if (health.peers.length === 0) return null;

  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-ink-800 hover:text-slate-300"
        onClick={() => setOpen((current) => !current)}
        title="Como a sua conexão está indo"
      >
        <Dot grade={health.grade} />
        <span className="tabular-nums">
          ↓{formatBitrate(health.downBps)} ↑{formatBitrate(health.upBps)}
        </span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-64 animate-fade-up rounded-lg border border-ink-700/70 bg-ink-900/95 p-3 shadow-pop backdrop-blur-md">
          <p className="text-xs font-medium text-slate-200">Conexões</p>
          <ul className="mt-2 flex flex-col gap-2">
            {health.peers.map((peer) => (
              <li key={peer.peerId} className="flex items-center gap-2">
                <Dot grade={peer.grade} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                  {participantName(participants, peer.peerId)}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                  {describePeer(peer.rttMs, peer.lossPercent, peer.connected)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[10px] leading-relaxed text-slate-500">
            Perda acima de 3% pica a voz; ida e volta acima de 300 ms faz todo mundo falar por
            cima. Se só uma pessoa está vermelha, é a rede dela.
          </p>
        </div>
      )}
    </div>
  );
}

function describePeer(rttMs: number | null, lossPercent: number | null, connected: boolean): string {
  if (!connected) return 'ligando…';
  const parts: string[] = [];
  if (rttMs !== null) parts.push(`${Math.round(rttMs)} ms`);
  if (lossPercent !== null && lossPercent >= 0.1) parts.push(`${lossPercent.toFixed(1)}% perda`);
  return parts.length > 0 ? parts.join(' · ') : 'medindo…';
}

const TONE: Record<NetGrade, string> = {
  good: 'bg-emerald-400',
  fair: 'bg-amber-400',
  poor: 'bg-red-400',
  unknown: 'bg-slate-600',
};

function Dot({ grade }: { grade: NetGrade }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${TONE[grade]} ${grade === 'poor' ? 'animate-breathe' : ''}`}
    />
  );
}

/** Reexportado só para quem quiser o ícone junto do rótulo em outra tela. */
export const NetworkIcon = Icon.wifi;
