import { useEffect, useState } from 'react';
import { useSession } from '../state/store';
import { Icon } from './Icons';

/**
 * Fila de quem bateu na porta, com a sala em aprovação manual.
 *
 * Fica ancorada no topo porque a decisão é urgente: do outro lado tem alguém
 * numa tela de espera. Se o pedido evaporar (a pessoa cansou), o main devolve
 * `false` e a linha some sozinha - não vale mentir dizendo que entrou.
 */
export function JoinRequests() {
  const requests = useSession((s) => s.joinRequests);
  const setJoinRequests = useSession((s) => s.setJoinRequests);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Ao reabrir a tela (ou voltar de uma queda) a fila real está no host.
  useEffect(() => {
    void window.only.listJoinRequests().then(setJoinRequests).catch(() => undefined);
  }, [setJoinRequests]);

  if (requests.length === 0) return null;

  async function decide(id: string, accept: boolean) {
    setBusyId(id);
    try {
      await window.only.decideJoin(id, accept);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-ink-700/70 bg-accent/10 px-4 py-2">
      {requests.map((request) => (
        <div key={request.id} className="flex animate-fade-up items-center gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/20 text-accent">
            <Icon.shield size={13} />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-slate-200">
            <span className="font-medium">{request.username}</span>
            <span className="text-slate-500"> quer entrar</span>
          </p>
          <button
            className="btn-primary px-3 py-1 text-xs"
            disabled={busyId === request.id}
            onClick={() => void decide(request.id, true)}
          >
            Aceitar
          </button>
          <button
            className="btn-ghost px-3 py-1 text-xs"
            disabled={busyId === request.id}
            onClick={() => void decide(request.id, false)}
          >
            Recusar
          </button>
        </div>
      ))}
    </div>
  );
}
