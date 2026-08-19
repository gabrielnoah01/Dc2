import { useState } from 'react';
import type { ConnectionInfo } from '../state/store';
import { Icon } from './Icons';

/**
 * O que o host precisa ter à mão: o que mandar para o pessoal, e se dá para
 * entrar pela internet ou só pela rede local.
 *
 * Os códigos ficam **escondidos por padrão**. Este é um app de compartilhar
 * tela: o código carrega o IP e o token, e quem estiver assistindo à
 * transmissão — ou passando atrás da cadeira — entraria na sala sem ser
 * convidado. Copiar funciona sem revelar nada.
 */
export function InviteBar({ connection }: { connection: ConnectionInfo }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(kind: string, value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1600);
  }

  // Vale para os dois caminhos de fora: porta aberta no roteador ou ponte.
  const internetWorks =
    connection.inviteCode !== null &&
    (connection.portStatus === 'mapped' || connection.portStatus === 'tunnel');

  return (
    <header className="flex animate-slide-down flex-col gap-2 border-b border-ink-700/70 bg-ink-800/70 px-4 py-2 text-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CodeChip
          icon={<Icon.wifi size={13} />}
          label="Mesmo Wi-Fi"
          code={connection.localInviteCode}
          revealed={revealed}
          copied={copied === 'lan'}
          onCopy={() => copy('lan', connection.localInviteCode)}
        />

        {connection.inviteCode && (
          <CodeChip
            icon={<Icon.globe size={13} />}
            label="Internet"
            code={connection.inviteCode}
            revealed={revealed}
            copied={copied === 'net'}
            disabled={!internetWorks}
            onCopy={() => copy('net', connection.inviteCode!)}
          />
        )}

        <button
          className="btn-ghost gap-1.5 px-2 py-1 text-xs"
          onClick={() => setRevealed((current) => !current)}
          title={
            revealed ? 'esconder de novo — o código dá acesso à sala' : 'mostrar o código na tela'
          }
        >
          {revealed ? <EyeOff /> : <Eye />}
          {revealed ? 'Esconder' : 'Mostrar'}
        </button>

        <PortStatusLabel connection={connection} />
      </div>

      {connection.portStatus === 'checking' && (
        <p className="text-xs text-slate-500">
          Falando com o roteador para abrir a porta {connection.port}… isso leva alguns
          segundos. O link de rede local já funciona.
        </p>
      )}

      {connection.portStatus === 'tunneling' && (
        <p className="text-xs text-slate-500">
          A porta não abriu no roteador, então estou montando uma ponte de internet por fora
          dele… {connection.portMappingDetail} O link de rede local já funciona.
        </p>
      )}

      {connection.portStatus === 'tunnel' && (
        <p className="text-xs text-slate-500">
          Sem mexer no roteador: o link de internet entra por uma ponte da Cloudflare. Voz e
          tela continuam indo direto de máquina para máquina.
        </p>
      )}

      {connection.behindCarrierNat && connection.portStatus !== 'tunnel' && (
        <p className="text-xs text-amber-300">
          Sua operadora usa CGNAT: o link de internet não vai funcionar nem abrindo a porta,
          porque seu IP é compartilhado com outros clientes. Use o link de rede local, ou peça
          um IP público à operadora.
        </p>
      )}

      {connection.portStatus === 'closed' && !connection.behindCarrierNat && (
        <p className="text-xs text-amber-300">
          Não consegui abrir a porta {connection.port} sozinho, e a ponte de internet também
          não subiu. {connection.portMappingDetail} Pela internet só vai funcionar liberando a
          porta {connection.port} TCP no roteador. O link de rede local funciona do mesmo jeito.
        </p>
      )}
    </header>
  );
}

function CodeChip({
  icon,
  label,
  code,
  revealed,
  copied,
  disabled = false,
  onCopy,
}: {
  icon: React.ReactNode;
  label: string;
  code: string;
  revealed: boolean;
  copied: boolean;
  disabled?: boolean;
  onCopy(): void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg bg-ink-950/70 py-1 pl-2.5 pr-1 ring-1 ring-ink-600 ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </span>

      <code
        className={`font-mono text-xs ${revealed ? 'text-slate-200' : 'select-none text-slate-600'}`}
        // Escondido, mostramos pontos do tamanho aproximado do código, para a
        // barra não pular de largura quando o usuário revela.
        title={revealed ? code : 'código escondido'}
      >
        {revealed ? code : '•'.repeat(Math.min(22, code.length))}
      </code>

      <button
        className={`rounded-md p-1.5 transition-colors ${
          copied ? 'text-speak' : 'text-slate-500 hover:bg-ink-700 hover:text-slate-200'
        }`}
        onClick={onCopy}
        disabled={disabled}
        title="Copiar (funciona mesmo escondido)"
      >
        {copied ? <Icon.check size={14} /> : <Icon.copy size={14} />}
      </button>
    </div>
  );
}

function PortStatusLabel({ connection }: { connection: ConnectionInfo }) {
  if (connection.portStatus === 'checking' || connection.portStatus === 'tunneling') {
    return (
      <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
        <span className="h-3 w-3 animate-spin-slow rounded-full border border-slate-600 border-t-accent" />
        {connection.portStatus === 'checking' ? 'verificando roteador…' : 'abrindo ponte…'}
      </span>
    );
  }

  return (
    <span
      className={`ml-auto text-xs ${
        connection.portStatus === 'closed' ? 'text-amber-300' : 'text-speak'
      }`}
      title={connection.portMappingDetail}
    >
      {connection.portStatus === 'mapped'
        ? `porta ${connection.port} aberta automaticamente`
        : connection.portStatus === 'tunnel'
          ? 'entrando por ponte de internet'
          : `porta ${connection.port} fechada`}
    </span>
  );
}

function Eye() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.7 3.4M6.6 6.6A18 18 0 0 0 2 12s3.5 6 10 6a9.7 9.7 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20" />
    </svg>
  );
}
