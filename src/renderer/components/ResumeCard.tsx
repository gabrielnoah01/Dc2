import { useEffect, useState } from 'react';
import type { LastSession } from '@shared/settings';
import { useSession } from '../state/store';
import { Icon } from '../components/Icons';

/**
 * Convite da tela inicial: "a última sala ainda está te esperando?".
 * Só aparece quando o main guardou uma queda recente — quem saiu clicando
 * em "Sair" não vê nada, porque aquela saída foi consciente.
 */
export function ResumeCard() {
  const [last, setLast] = useState<LastSession | null>(null);
  const setError = useSession((s) => s.setError);
  const busy = useSession((s) => s.busy);
  const setBusy = useSession((s) => s.setBusy);

  useEffect(() => {
    void window.only
      .getLastSession()
      .then(setLast)
      .catch(() => undefined);
  }, []);

  // Saída consciente não vira convite: só queda interrompe a tela inicial.
  if (!last || !last.dropped) return null;

  async function reconnect() {
    setBusy(true);
    setError(null);
    const result = await window.only.reconnectNow();
    setBusy(false);
    // Deu certo: o main dispara `reconnect` e a tela troca sozinha.
    if (!result.ok) {
      setError(result.error);
      setLast(null);
    }
  }

  function dismiss() {
    setLast(null);
    void window.only.forgetLastSession();
  }

  return (
    <div className="z-10 mt-6 w-full max-w-md animate-pop-in rounded-xl bg-ink-900/80 p-3 ring-1 ring-ink-700">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <Icon.globe size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-slate-200">
            Última conexão em <span className="font-mono">{last.label}</span>
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {describeDrop(last)} · Tentar reconectar?
          </p>
        </div>
        <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={reconnect}>
          Reconectar
        </button>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={dismiss}>
          Agora não
        </button>
      </div>
    </div>
  );
}

/** "há 4 minutos, conexão caiu" — contexto suficiente para decidir num olhar. */
function describeDrop(last: LastSession): string {
  const when = relativeTime(last.endedAt);
  return last.reason ? `${when} · ${last.reason}` : when;
}

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'agora há pouco';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `há ${hours} h` : 'ontem';
}
