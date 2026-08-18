import { useEffect, useState } from 'react';
import { useSession } from '../state/store';
import { APP_NAME, DEFAULT_PORT, MAX_USERNAME_LENGTH } from '@shared/constants';
import { useSettings } from '../state/settings';
import type { ConversationSummary } from '@shared/ipc';
import { parseInvite } from '@shared/inviteLink';
import { Logo } from '../components/Logo';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/Icons';

export function HomeScreen() {
  const startHost = useSession((s) => s.startHost);
  const startGuest = useSession((s) => s.startGuest);
  const setError = useSession((s) => s.setError);
  const setBusy = useSession((s) => s.setBusy);
  const busy = useSession((s) => s.busy);
  const lastError = useSession((s) => s.lastError);

  const settings = useSettings((s) => s.settings);
  const setSettingsOpen = useSettings((s) => s.setOpen);
  const saveSettings = useSettings((s) => s.save);

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState(settings.app.username);
  const [port, setPort] = useState(String(settings.network.defaultPort || DEFAULT_PORT));
  const [invite, setInvite] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState('');

  useEffect(() => {
    void window.only.listConversations().then(setConversations).catch(() => undefined);
  }, []);

  // As preferências chegam do main um instante depois da primeira renderização.
  useEffect(() => {
    if (settings.app.username) setName((current) => current || settings.app.username);
    setPort((current) =>
      current === String(DEFAULT_PORT) ? String(settings.network.defaultPort) : current,
    );
  }, [settings.app.username, settings.network.defaultPort]);

  function rememberName(value: string) {
    if (value !== settings.app.username) void saveSettings({ app: { username: value } });
  }

  /** Guarda o servidor para voltar depois sem recolar o código. */
  function rememberServer(code: string) {
    const parsed = parseInvite(code);
    if (!parsed) return;

    const entry = {
      invite: code,
      label: `${parsed.host}:${parsed.port}`,
      lastJoinedAt: Date.now(),
    };
    const others = settings.app.recentServers.filter((item) => item.invite !== code);
    void saveSettings({ app: { recentServers: [entry, ...others].slice(0, 4) } });
  }

  async function createServer() {
    setBusy(true);
    setError(null);
    const result = await window.only.createServer({
      username: name.trim(),
      port: Number(port) || DEFAULT_PORT,
      ...(conversationId ? { conversationId } : {}),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);

    rememberName(name.trim());
    const { selfId, participants, ...connection } = result.data;
    startHost(connection, selfId, participants);
  }

  async function joinServer(code = invite) {
    setBusy(true);
    setError(null);
    const result = await window.only.joinServer({ invite: code.trim(), username: name.trim() });
    setBusy(false);
    if (!result.ok) return setError(result.error);

    rememberName(name.trim());
    rememberServer(code.trim());

    const { selfId, participants, screenSharerIds } = result.data;
    startGuest(selfId, participants, screenSharerIds);
  }

  const named = name.trim().length > 0;
  const canCreate = named && !busy;
  const canJoin = named && invite.trim().length > 0 && !busy;
  const recent = settings.app.recentServers;

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden p-8">
      <Backdrop />

      <button
        className="btn-ghost absolute right-6 top-6 gap-2 px-3 py-1.5 text-xs"
        onClick={() => setSettingsOpen(true)}
      >
        <Icon.settings size={14} />
        Configurações
      </button>

      <header className="z-10 flex animate-fade-up flex-col items-center text-center">
        <div className="relative mb-4">
          <div className="absolute inset-0 -z-10 rounded-full bg-accent/25 blur-2xl" />
          <Logo size={60} />
        </div>
        <h1 className="bg-gradient-to-b from-white to-slate-400 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
          {APP_NAME}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Conversa direta entre amigos. Sem servidor no meio: alguém abre, os outros entram.
        </p>
      </header>

      {lastError && (
        <p className="z-10 mt-6 max-w-xl animate-pop-in rounded-lg bg-red-950/70 px-4 py-2 text-center text-sm text-red-300 ring-1 ring-red-900/80">
          {lastError}
        </p>
      )}

      <div className="z-10 mt-8 w-full max-w-md animate-fade-up [animation-delay:80ms]">
        {/* O nome vale para os dois caminhos, então fica fora das abas. */}
        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-500">
          Seu nome
        </label>
        <input
          className="field mb-5"
          value={name}
          maxLength={MAX_USERNAME_LENGTH}
          placeholder="como os outros vão te ver"
          onChange={(event) => setName(event.target.value)}
        />

        <div className="mb-5 flex gap-1 rounded-xl bg-ink-950/60 p-1 ring-1 ring-ink-700">
          <Tab active={mode === 'create'} onClick={() => setMode('create')}>
            <Icon.plus size={14} />
            Criar servidor
          </Tab>
          <Tab active={mode === 'join'} onClick={() => setMode('join')}>
            <Icon.enter size={14} />
            Entrar
          </Tab>
        </div>

        {mode === 'create' ? (
          <div key="create" className="flex animate-fade-in flex-col gap-4">
            <p className="text-xs leading-relaxed text-slate-500">
              Seu PC vira o ponto de encontro. Ele precisa ficar aberto enquanto durar a
              conversa — o app continua na bandeja se você fechar a janela.
            </p>

            {conversations.length > 0 && (
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-500">
                  Continuar conversa
                </label>
                <Dropdown
                  className="w-full"
                  value={conversationId}
                  onChange={setConversationId}
                  options={[
                    { value: '', label: 'Nova conversa', hint: 'começa do zero' },
                    ...conversations.map((conversation) => ({
                      value: conversation.id,
                      label: conversation.name,
                      hint: `${conversation.messageCount} mensagens`,
                    })),
                  ]}
                />
              </div>
            )}

            <Advanced open={advanced} onToggle={() => setAdvanced((current) => !current)}>
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-500">
                Porta
              </label>
              <input
                className="field"
                value={port}
                inputMode="numeric"
                onChange={(event) =>
                  setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))
                }
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                Só mexa aqui se a {DEFAULT_PORT} já estiver ocupada por outro programa. É esta
                porta que o app tenta abrir sozinho no seu roteador.
              </p>
            </Advanced>

            <button className="btn-primary w-full" disabled={!canCreate} onClick={createServer}>
              {busy ? 'Abrindo…' : 'Criar servidor'}
            </button>
          </div>
        ) : (
          <div key="join" className="flex animate-fade-in flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-500">
                Link ou código
              </label>
              <div className="flex gap-2">
                <input
                  className="field flex-1 font-mono text-xs"
                  value={invite}
                  placeholder="203.0.113.5:51820#Xk29Ab3F"
                  onChange={(event) => setInvite(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canJoin) void joinServer();
                  }}
                />
                <button
                  className="btn-ghost px-3"
                  title="Colar da área de transferência"
                  onClick={async () => setInvite((await navigator.clipboard.readText()).trim())}
                >
                  <Icon.copy size={15} />
                </button>
              </div>
            </div>

            {recent.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                  Voltar para
                </p>
                <div className="flex flex-wrap gap-2">
                  {recent.map((server) => (
                    <button
                      key={server.invite}
                      className="group flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-1.5 text-xs text-slate-300 ring-1 ring-ink-600 transition-all hover:bg-ink-700 hover:ring-accent"
                      disabled={!named || busy}
                      onClick={() => void joinServer(server.invite)}
                      title="Entrar de novo neste servidor"
                    >
                      <Icon.globe size={13} className="text-slate-500 group-hover:text-accent" />
                      <span className="font-mono">{server.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              className="btn-primary w-full"
              disabled={!canJoin}
              onClick={() => void joinServer()}
            >
              {busy ? 'Conectando…' : 'Entrar no servidor'}
            </button>
          </div>
        )}
      </div>

      <p className="z-10 mt-8 flex items-center gap-1.5 text-[11px] text-slate-600">
        <Icon.shield size={12} />
        Voz e tela criptografadas ponta a ponta
      </p>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
        active ? 'bg-ink-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Guarda o que quase ninguém precisa mexer. A porta é o exemplo perfeito:
 * obrigatória para o app funcionar, irrelevante para quem só quer conversar.
 */
function Advanced({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-ink-950/40 ring-1 ring-ink-700/70">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-500 transition-colors hover:text-slate-300"
      >
        <Icon.chevron
          size={13}
          className={`transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
        />
        Opções avançadas
      </button>
      {open && <div className="animate-slide-down px-3 pb-3">{children}</div>}
    </div>
  );
}

/** Manchas de cor que respiram atrás do conteúdo, para o fundo não ser chapado. */
function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 top-0 h-96 w-96 animate-breathe rounded-full bg-accent/10 blur-3xl" />
      <div className="absolute -right-24 bottom-0 h-80 w-80 animate-breathe rounded-full bg-indigo-500/10 blur-3xl [animation-delay:1.2s]" />
    </div>
  );
}
