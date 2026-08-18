import { useEffect, useState } from 'react';
import { useSession } from '../state/store';
import { APP_NAME, DEFAULT_PORT, MAX_USERNAME_LENGTH } from '@shared/constants';
import { useSettings } from '../state/settings';
import type { ConversationSummary } from '@shared/ipc';

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

  const [hostName, setHostName] = useState(settings.app.username);
  const [port, setPort] = useState(String(settings.network.defaultPort || DEFAULT_PORT));
  const [guestName, setGuestName] = useState(settings.app.username);
  const [invite, setInvite] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState('');

  useEffect(() => {
    void window.only.listConversations().then(setConversations).catch(() => undefined);
  }, []);

  // As preferências chegam do main um instante depois da primeira renderização.
  useEffect(() => {
    if (settings.app.username) {
      setHostName((current) => current || settings.app.username);
      setGuestName((current) => current || settings.app.username);
    }
    setPort((current) =>
      current === String(DEFAULT_PORT) ? String(settings.network.defaultPort) : current,
    );
  }, [settings.app.username, settings.network.defaultPort]);

  async function createServer() {
    setBusy(true);
    setError(null);
    const result = await window.only.createServer({
      username: hostName.trim(),
      port: Number(port) || DEFAULT_PORT,
      ...(conversationId ? { conversationId } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Lembra o nome para a próxima vez.
    if (hostName.trim() !== settings.app.username) {
      void saveSettings({ app: { username: hostName.trim() } });
    }
    const { selfId, participants, ...connection } = result.data;
    startHost(connection, selfId, participants);
  }

  async function joinServer() {
    setBusy(true);
    setError(null);
    const result = await window.only.joinServer({
      invite: invite.trim(),
      username: guestName.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (guestName.trim() !== settings.app.username) {
      void saveSettings({ app: { username: guestName.trim() } });
    }
    const { selfId, participants, screenSharerIds } = result.data;
    startGuest(selfId, participants, screenSharerIds);
  }

  const canCreate = hostName.trim().length > 0 && !busy;
  const canJoin = guestName.trim().length > 0 && invite.trim().length > 0 && !busy;

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-8 p-8">
      <button
        className="absolute right-6 top-6 text-slate-500 transition-colors hover:text-slate-200"
        onClick={() => setSettingsOpen(true)}
        title="Configurações"
      >
        ⚙ Configurações
      </button>

      <header className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-accent">{APP_NAME}</h1>
        <p className="mt-2 text-sm text-slate-400">
          Conversa direta entre amigos. Sem servidor no meio: alguém abre, os outros entram.
        </p>
      </header>

      {lastError && (
        <p className="max-w-xl rounded-md bg-red-950/60 px-4 py-2 text-center text-sm text-red-300 ring-1 ring-red-900">
          {lastError}
        </p>
      )}

      <div className="grid w-full max-w-3xl gap-5 md:grid-cols-2">
        <section className="card flex flex-col gap-3">
          <h2 className="text-lg font-medium">Criar servidor</h2>
          <p className="text-sm text-slate-400">
            Seu PC vira o ponto de encontro. Ele precisa ficar aberto enquanto durar a conversa.
          </p>
          <label className="text-xs uppercase tracking-wide text-slate-500">Seu nome</label>
          <input
            className="field"
            value={hostName}
            maxLength={MAX_USERNAME_LENGTH}
            placeholder="como os outros vão te ver"
            onChange={(e) => setHostName(e.target.value)}
          />
          <label className="text-xs uppercase tracking-wide text-slate-500">Porta</label>
          <input
            className="field"
            value={port}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
          />
          {conversations.length > 0 && (
            <>
              <label className="text-xs uppercase tracking-wide text-slate-500">Conversa</label>
              <select
                className="field"
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
              >
                <option value="">Nova conversa</option>
                {conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.name} — {conversation.messageCount} msg
                  </option>
                ))}
              </select>
            </>
          )}
          <button className="btn-primary mt-2" disabled={!canCreate} onClick={createServer}>
            {busy ? 'Abrindo…' : 'Criar servidor'}
          </button>
        </section>

        <section className="card flex flex-col gap-3">
          <h2 className="text-lg font-medium">Entrar em servidor</h2>
          <p className="text-sm text-slate-400">
            Cole o link ou o código que a pessoa que abriu o servidor te mandou.
          </p>
          <label className="text-xs uppercase tracking-wide text-slate-500">Seu nome</label>
          <input
            className="field"
            value={guestName}
            maxLength={MAX_USERNAME_LENGTH}
            placeholder="como os outros vão te ver"
            onChange={(e) => setGuestName(e.target.value)}
          />
          <label className="text-xs uppercase tracking-wide text-slate-500">Link ou código</label>
          <input
            className="field"
            value={invite}
            placeholder="203.0.113.5:51820#Xk29Ab3F"
            onChange={(e) => setInvite(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canJoin) void joinServer();
            }}
          />
          <button className="btn-primary mt-2" disabled={!canJoin} onClick={joinServer}>
            {busy ? 'Conectando…' : 'Entrar'}
          </button>
        </section>
      </div>
    </div>
  );
}
