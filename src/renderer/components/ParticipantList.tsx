import { useEffect, useRef, useState } from 'react';
import type { Participant } from '@shared/protocol';
import { useSettings } from '../state/settings';

interface Props {
  participants: Participant[];
  selfId: string;
  speakingIds: string[];
  screenSharerIds: string[];
}

export function ParticipantList({ participants, selfId, speakingIds, screenSharerIds }: Props) {
  const speaking = new Set(speakingIds);
  const sharing = new Set(screenSharerIds);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const settings = useSettings((s) => s.settings);
  const setSettingsOpen = useSettings((s) => s.setOpen);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-ink-700/70 bg-ink-800/60 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">
          Conectados — {participants.length}
        </h2>
        <button
          className="ml-auto text-slate-500 transition-colors hover:text-slate-200"
          onClick={() => setSettingsOpen(true)}
          title="Configurações"
        >
          ⚙
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 pb-2">
        {participants.map((participant) => {
          const isSelf = participant.id === selfId;
          const peer = settings.peers[participant.username];
          const isMuted = !isSelf && peer?.muted === true;
          const isSpeaking = speaking.has(participant.id) && !isMuted;

          return (
            <li key={participant.id} className="relative">
              <button
                onClick={() => setOpenFor((current) => (current === participant.id ? null : participant.id))}
                disabled={isSelf}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-ink-700/70 disabled:hover:bg-transparent"
                title={isSelf ? '' : 'clique para ajustar volume ou silenciar (só para você)'}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-b from-ink-500 to-ink-600 text-sm font-medium ring-2 transition-all duration-200 ${
                    isSpeaking
                      ? 'animate-ring-pulse scale-105 ring-speak'
                      : 'ring-transparent'
                  }`}
                >
                  {participant.username.slice(0, 1).toUpperCase()}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    isMuted ? 'text-slate-500 line-through' : ''
                  }`}
                >
                  {participant.username}
                  {isSelf && <span className="text-slate-500"> (você)</span>}
                </span>
                {participant.isHost && (
                  <span className="text-[10px] uppercase text-accent" title="dono do servidor">
                    host
                  </span>
                )}
                {sharing.has(participant.id) && (
                  <span className="text-xs" title="compartilhando a tela">
                    🖥
                  </span>
                )}
                {isMuted && (
                  <span className="text-xs" title="silenciada por você">
                    🔇
                  </span>
                )}
              </button>

              {openFor === participant.id && !isSelf && (
                <PeerPopover
                  username={participant.username}
                  onClose={() => setOpenFor(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/**
 * Ajustes locais de uma pessoa. Vale reforçar na própria interface que isso é
 * só para quem está mexendo — silenciar aqui não afeta ninguém mais.
 */
function PeerPopover({ username, onClose }: { username: string; onClose(): void }) {
  const forPeer = useSettings((s) => s.forPeer);
  const setPeer = useSettings((s) => s.setPeer);
  const peer = forPeer(username);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    // `setTimeout` evita fechar no mesmo clique que abriu.
    const timer = window.setTimeout(
      () => window.addEventListener('mousedown', onPointerDown),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-2 right-2 z-10 mt-1 flex animate-pop-in flex-col gap-3 rounded-lg bg-ink-800 p-3 shadow-pop ring-1 ring-ink-500"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-300">{username}</span>
        <button
          className={`rounded px-2 py-1 text-xs transition-colors ${
            peer.muted
              ? 'bg-red-900 text-red-100 hover:bg-red-800'
              : 'bg-ink-600 text-slate-300 hover:bg-ink-500'
          }`}
          onClick={() => void setPeer(username, { muted: !peer.muted })}
        >
          {peer.muted ? '🔇 Silenciada' : '🔊 Silenciar'}
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="flex justify-between text-[11px] text-slate-500">
          <span>Volume</span>
          <span className="tabular-nums">{peer.volume}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={200}
          value={peer.volume}
          disabled={peer.muted}
          onChange={(event) => void setPeer(username, { volume: Number(event.target.value) })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-ink-500 accent-accent disabled:opacity-40"
        />
      </label>

      <p className="text-[11px] leading-snug text-slate-600">
        Só para você. A pessoa não é avisada e continua sendo ouvida pelos outros.
      </p>
    </div>
  );
}
