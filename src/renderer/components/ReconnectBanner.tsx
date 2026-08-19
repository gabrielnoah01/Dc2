import { useEffect, useState } from 'react';
import { useSession } from '../state/store';

/**
 * Faixa que fica sobre a sala enquanto a conexão está voltando. A tela por
 * baixo continua montada de propósito: o histórico e a lista de gente seguem
 * ali, então a queda parece um soluço e não um fim de conversa.
 */
export function ReconnectBanner() {
  const status = useSession((s) => s.reconnect);
  const applyReconnect = useSession((s) => s.applyReconnect);
  const [now, setNow] = useState(Date.now());

  const retrying = status.state === 'retrying';
  const reconnected = status.state === 'reconnected';

  // Um tique por segundo só enquanto existe contagem na tela.
  useEffect(() => {
    if (!retrying) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [retrying]);

  // O aviso de "voltou" some sozinho - ninguém precisa fechar.
  useEffect(() => {
    if (!reconnected) return;
    const timer = setTimeout(() => applyReconnect({ state: 'idle' }), 2600);
    return () => clearTimeout(timer);
  }, [reconnected, applyReconnect]);

  if (status.state === 'idle' || status.state === 'failed') return null;

  if (reconnected) {
    return (
      <Shell tone="ok">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span>Conexão restabelecida</span>
      </Shell>
    );
  }

  const seconds =
    status.state === 'retrying' ? Math.max(0, Math.ceil((status.nextAttemptAt - now) / 1000)) : 0;

  return (
    <Shell tone="warn">
      <span className="h-3 w-3 shrink-0 animate-spin-slow rounded-full border-2 border-ink-600 border-t-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-slate-200">
          {status.state === 'connecting'
            ? `Reconectando a ${status.label}…`
            : seconds > 0
              ? `Nova tentativa em ${seconds}s`
              : 'Reconectando…'}
        </p>
        <p className="truncate text-[11px] text-slate-500">
          {status.reason} · tentativa {status.attempt} de {status.maxAttempts}
        </p>
      </div>
      {status.state === 'retrying' && (
        <button
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => void window.only.reconnectNow()}
        >
          Tentar agora
        </button>
      )}
      <button
        className="btn-ghost px-2 py-1 text-xs text-slate-500"
        onClick={() => void window.only.cancelReconnect()}
      >
        Sair
      </button>
    </Shell>
  );
}

function Shell({ tone, children }: { tone: 'warn' | 'ok'; children: React.ReactNode }) {
  return (
    <div
      className={`flex animate-slide-down items-center gap-3 px-4 py-2 text-sm ring-1 ${
        tone === 'ok'
          ? 'bg-emerald-950/60 text-emerald-300 ring-emerald-900/70'
          : 'bg-ink-950/80 ring-ink-700'
      }`}
    >
      {children}
    </div>
  );
}
