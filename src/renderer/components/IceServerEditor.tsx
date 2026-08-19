import { useState } from 'react';
import { isIceUrl, type IceServerSetting } from '@shared/settings';
import { MAX_ICE_SERVERS } from '@shared/constants';
import { Icon } from './Icons';

/**
 * Lista de STUN/TURN próprios.
 *
 * Um TURN da pessoa é o único jeito de provar que a conexão fecha atrás de
 * CGNAT ou firewall corporativo, então o editor precisa ser honesto sobre o
 * que aceita: URL malformada é recusada aqui, na frente dos olhos, em vez de
 * virar um "a voz não conecta" silencioso meia hora depois.
 */
export function IceServerEditor({
  servers,
  onChange,
}: {
  servers: IceServerSetting[];
  onChange(next: IceServerSetting[]): void;
}) {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [credential, setCredential] = useState('');

  const trimmed = url.trim();
  const full = servers.length >= MAX_ICE_SERVERS;
  const duplicate = servers.some((server) => server.url === trimmed);
  const valid = isIceUrl(trimmed) && !duplicate && !full;

  function add() {
    if (!valid) return;
    onChange([...servers, { url: trimmed, username: username.trim(), credential: credential.trim() }]);
    setUrl('');
    setUsername('');
    setCredential('');
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-ink-800/40 p-3">
      <div>
        <p className="text-xs font-medium text-slate-300">Servidores STUN/TURN próprios</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          Entram junto com os públicos (ou sozinhos, se você desligar o STUN público).
          Ex.: <code className="text-slate-400">turn:meu.servidor.com:3478</code>
        </p>
      </div>

      {servers.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {servers.map((server, index) => (
            <li
              key={server.url}
              className="flex items-center gap-2 rounded-md bg-ink-900/70 px-2.5 py-1.5"
            >
              <Icon.globe size={13} className="shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
                {server.url}
              </span>
              {server.username && (
                <span className="shrink-0 text-[10px] text-slate-500">{server.username}</span>
              )}
              <button
                className="shrink-0 rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-red-300"
                title="Remover"
                onClick={() => onChange(servers.filter((_, other) => other !== index))}
              >
                <Icon.trash size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <input
            className="field min-w-0 flex-1 font-mono text-[11px]"
            placeholder="turn:servidor:3478"
            value={url}
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && add()}
          />
          <button className="btn-primary shrink-0 gap-1 px-3 text-xs" disabled={!valid} onClick={add}>
            <Icon.plus size={13} />
            Adicionar
          </button>
        </div>
        {/* TURN quase sempre pede senha; STUN nunca — deixar os dois vazios é normal. */}
        <div className="flex gap-1.5">
          <input
            className="field min-w-0 flex-1 text-[11px]"
            placeholder="usuário (só TURN)"
            value={username}
            spellCheck={false}
            onChange={(event) => setUsername(event.target.value)}
          />
          <input
            className="field min-w-0 flex-1 text-[11px]"
            placeholder="senha (só TURN)"
            type="password"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && add()}
          />
        </div>
      </div>

      <p className="text-[11px] text-slate-500">{describe(trimmed, { duplicate, full })}</p>
    </div>
  );
}

function describe(url: string, { duplicate, full }: { duplicate: boolean; full: boolean }): string {
  if (full) return `Limite de ${MAX_ICE_SERVERS} servidores atingido — remova um para adicionar outro.`;
  if (!url) return 'A senha fica só no seu PC, e viaja para o navegador na hora de conectar.';
  if (duplicate) return 'Esse servidor já está na lista.';
  if (!isIceUrl(url)) return 'O endereço precisa começar com stun:, turn: ou turns:.';
  return 'Pronto para adicionar.';
}
