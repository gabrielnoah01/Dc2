import { useState } from 'react';
import type { ConnectionInfo } from '../state/store';

/**
 * O host precisa de duas respostas na mão: "o que eu mando pro pessoal?" e
 * "dá pra entrar pela internet ou só pela minha rede?".
 */
export function InviteBar({ connection }: { connection: ConnectionInfo }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(kind: string, value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
  }

  // Pela internet só funciona com a porta aberta e sem CGNAT da operadora.
  const internetWorks =
    connection.inviteCode !== null && connection.portMapped && !connection.behindCarrierNat;

  return (
    <header className="flex flex-col gap-2 border-b border-ink-600 bg-ink-800 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-slate-400">Mesmo Wi-Fi:</span>
        <code className="rounded bg-ink-900 px-2 py-1 text-slate-200">
          {connection.localInviteCode}
        </code>
        <button
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => copy('lan', connection.localInviteCode)}
        >
          {copied === 'lan' ? 'copiado' : 'copiar'}
        </button>

        {connection.inviteCode && (
          <>
            <span className="ml-2 text-slate-400">Internet:</span>
            <code
              className={`rounded bg-ink-900 px-2 py-1 ${
                internetWorks ? 'text-slate-200' : 'text-slate-500 line-through'
              }`}
            >
              {connection.inviteCode}
            </code>
            <button
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => copy('net', connection.inviteCode!)}
              disabled={!internetWorks}
            >
              {copied === 'net' ? 'copiado' : 'copiar'}
            </button>
          </>
        )}

        <span
          className={`ml-auto text-xs ${connection.portMapped ? 'text-emerald-400' : 'text-amber-300'}`}
          title={connection.portMappingDetail}
        >
          {connection.portMapped
            ? `porta ${connection.port} aberta automaticamente`
            : `porta ${connection.port} fechada`}
        </span>
      </div>

      {connection.behindCarrierNat && (
        <p className="text-xs text-amber-300">
          Sua operadora usa CGNAT: o link de internet não vai funcionar nem abrindo a porta,
          porque seu IP é compartilhado com outros clientes. Use o link de rede local, ou peça
          um IP público à operadora.
        </p>
      )}

      {!connection.portMapped && !connection.behindCarrierNat && (
        <p className="text-xs text-amber-300">
          Não consegui abrir a porta {connection.port} sozinho (UPnP desligado no roteador).
          Pela internet só vai funcionar se você liberar a porta {connection.port} TCP no
          roteador. O link de rede local funciona do mesmo jeito.
        </p>
      )}
    </header>
  );
}
