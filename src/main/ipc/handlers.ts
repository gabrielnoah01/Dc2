import { BrowserWindow, ipcMain } from 'electron';
import { listScreenSources, selectScreenSource } from '../screenSource';
import { checkForUpdates, installUpdate } from '../updater';
import { loadSettings, resetSettings, updateSettings } from '../settings';
import {
  appendMessage,
  attachmentDataUrl,
  clearMessages,
  closeConversation,
  currentConversationId,
  deleteConversation,
  listConversations,
  openConversation,
  pruneConversations,
  pruneEmptyConversations,
  pruneMessages,
  recentMessages,
} from '../chatStore';
import { registerShortcuts } from '../shortcuts';
import { globalShortcut } from 'electron';
import type { SettingsPatch } from '../../shared/ipc';
import { HostServer } from '../network/hostServer';
import { GuestClient } from '../network/guestClient';
import { mapPort, unmapPort, type PortMappingResult } from '../network/upnp';
import { resolveLocalIp, resolvePublicIp } from '../network/publicIp';
import {
  ActionResult,
  ConnectionUpdate,
  CreateServerOptions,
  CreateServerResult,
  IPC,
  IPC_EVENT,
  IncomingSignal,
  JoinServerOptions,
  JoinServerResult,
  Role,
  ScreenSource,
  SignalPayload,
} from '../../shared/ipc';
import { ChatMessage, Participant, ServerMessage } from '../../shared/protocol';
import {
  buildInviteCode,
  buildInviteUrl,
  generateToken,
  parseInvite,
} from '../../shared/inviteLink';

interface Session {
  role: Exclude<Role, null>;
  host?: HostServer;
  guest?: GuestClient;
}

let session: Session | null = null;

function broadcastToRenderer(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.createServer, (_event, options: CreateServerOptions) =>
    createServer(options),
  );
  ipcMain.handle(IPC.joinServer, (_event, options: JoinServerOptions) =>
    joinServer(options),
  );
  ipcMain.handle(IPC.leave, () => disposeSession());
  ipcMain.handle(IPC.sendChat, (_event, payload: ChatPayload) => sendChat(payload));
  ipcMain.handle(IPC.sendSignal, (_event, payload: SignalPayload) => sendSignal(payload));
  ipcMain.handle(IPC.setScreenShare, (_event, active: boolean) => setScreenShare(active));
  ipcMain.handle(IPC.getScreenSources, () => getScreenSources());
  ipcMain.handle(IPC.selectScreenSource, (_event, sourceId: string) =>
    selectScreenSource(sourceId),
  );
  ipcMain.handle(IPC.checkUpdate, () => checkForUpdates());
  ipcMain.handle(IPC.installUpdate, () => installUpdate());

  ipcMain.handle(IPC.requestAttachment, (_event, messageId: string) =>
    requestAttachment(messageId),
  );
  ipcMain.handle(IPC.listConversations, () => {
    // Conversa sem mensagem nenhuma é ruído na hora de escolher o que restaurar.
    pruneEmptyConversations();
    return listConversations().filter((conversation) => conversation.messageCount > 0);
  });
  ipcMain.handle(IPC.deleteConversation, (_event, id: string) => deleteConversation(id));
  ipcMain.handle(IPC.clearConversation, (_event, id: string) => clearMessages(id));

  ipcMain.handle(IPC.getSettings, () => loadSettings());
  ipcMain.handle(IPC.updateSettings, (_event, patch: SettingsPatch) => {
    const settings = updateSettings(patch);
    // Atalho mudou? precisa reprogramar o registro global na hora.
    if (patch.shortcuts || patch.audio?.pttReleaseDelay !== undefined) {
      registerShortcuts(settings);
    }
    return settings;
  });
  ipcMain.handle(IPC.resetSettings, () => {
    const settings = resetSettings();
    registerShortcuts(settings);
    return settings;
  });
  ipcMain.handle(IPC.testShortcut, (_event, accelerator: string) =>
    testShortcut(accelerator),
  );
}

/**
 * Confere se uma combinação está livre. Registrar e soltar na hora é o único
 * jeito confiável — o Electron não expõe consulta de atalhos de outros apps.
 */
function testShortcut(accelerator: string): { ok: boolean; detail?: string } {
  if (!accelerator) return { ok: true };
  if (globalShortcut.isRegistered(accelerator)) {
    // Já é nosso: continua valendo.
    return { ok: true };
  }
  try {
    const ok = globalShortcut.register(accelerator, () => undefined);
    if (ok) globalShortcut.unregister(accelerator);
    return ok
      ? { ok: true }
      : { ok: false, detail: 'outro programa já usa esta combinação' };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'combinação inválida',
    };
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

async function createServer(
  options: CreateServerOptions,
): Promise<ActionResult<CreateServerResult>> {
  await disposeSession();

  const token = generateToken();
  const chat = loadSettings().chat;

  // Abre (ou cria) a conversa antes do servidor subir: quem entrar já encontra
  // o histórico pronto para ser enviado.
  openConversation({ id: options.conversationId });
  pruneMessages(chat.retentionDays);
  // A conversa recém-aberta já está protegida: a limpeza pula a que está em uso.
  pruneConversations(chat.conversationRetentionDays);
  pruneEmptyConversations();
  startRetentionTimer();

  const host = new HostServer(token, options.username, {
    onParticipants: (participants: Participant[]) =>
      broadcastToRenderer(IPC_EVENT.participants, participants),
    onChat: (message: ChatMessage) => broadcastToRenderer(IPC_EVENT.chat, message),
    onSignal: (message) => broadcastToRenderer(IPC_EVENT.signal, toIncomingSignal(message)),
    onScreenShare: (sharerIds) => broadcastToRenderer(IPC_EVENT.screenShare, sharerIds),
    onError: (detail) => broadcastToRenderer(IPC_EVENT.error, detail),
  }, {
    // Com a gravação desligada, a sala funciona igual — só não deixa rastro.
    persist: (message) => (loadSettings().chat.saveHistory ? appendMessage(message) : message),
    history: () => recentMessages(loadSettings().chat.historyOnJoin),
    attachment: (messageId) => attachmentDataUrl(messageId),
  });

  try {
    await host.start(options.port);
  } catch (error) {
    return { ok: false, error: describePortError(error, options.port) };
  }

  session = { role: 'host', host };

  // O host também vê a conversa que escolheu continuar.
  const history = recentMessages(chat.historyOnJoin);
  if (history.length > 0) {
    setTimeout(() => broadcastToRenderer(IPC_EVENT.history, history), 0);
  }

  const localIp = resolveLocalIp() ?? '127.0.0.1';

  // A sala abre na hora com o link de rede local, que já basta para o caso mais
  // comum. UPnP e IP público levam segundos e chegam depois, por evento — antes
  // isso segurava a tela por até 8s à toa.
  void resolveNetworkInBackground(options.port, token);

  return {
    ok: true,
    data: {
      selfId: host.hostId,
      port: options.port,
      token,
      participants: host.getParticipants(),
      inviteCode: null,
      inviteUrl: null,
      localInviteCode: buildInviteCode({ host: localIp, port: options.port, token }),
      publicIp: null,
      localIp,
      portMapped: false,
    },
  };
}

/** Descobre acesso pela internet sem segurar a abertura da sala. */
async function resolveNetworkInBackground(port: number, token: string): Promise<void> {
  const { network } = loadSettings();
  const [mapping, publicIp] = await Promise.all([
    network.useUpnp
      ? mapPort(port)
      : Promise.resolve<PortMappingResult>({
          status: 'unavailable',
          detail: 'UPnP desligado nas configurações',
        }),
    resolvePublicIp(),
  ]);

  // Se o usuário já fechou o servidor nesse meio tempo, não há o que avisar.
  if (!session || session.role !== 'host') return;

  // Se o serviço externo falhar, o roteador ainda sabe o IP de saída.
  const externalIp = publicIp ?? mapping.routerExternalIp ?? null;

  const update: ConnectionUpdate = {
    inviteCode: externalIp ? buildInviteCode({ host: externalIp, port, token }) : null,
    inviteUrl: externalIp ? buildInviteUrl({ host: externalIp, port, token }) : null,
    publicIp: externalIp,
    portMapped: mapping.status === 'mapped',
    portMappingDetail: mapping.detail,
    behindCarrierNat: mapping.behindCarrierNat,
  };
  broadcastToRenderer(IPC_EVENT.connection, update);
}

// ---------------------------------------------------------------------------
// Convidado
// ---------------------------------------------------------------------------

async function joinServer(
  options: JoinServerOptions,
): Promise<ActionResult<JoinServerResult>> {
  await disposeSession();

  const invite = parseInvite(options.invite);
  if (!invite) {
    return { ok: false, error: 'link de convite inválido — cole o código completo' };
  }

  let accepted: Extract<ServerMessage, { type: 'join:accepted' }> | null = null;
  // O convidado acompanha quem está compartilhando; o host manda só as mudanças.
  const sharers = new Set<string>();

  const guest = new GuestClient({
    onMessage: (message) => {
      switch (message.type) {
        case 'join:accepted':
          accepted = message;
          // Host de versão antiga não manda a lista; tratar como vazia.
          for (const id of message.screenSharerIds ?? []) sharers.add(id);
          break;
        case 'presence:update':
          broadcastToRenderer(IPC_EVENT.participants, message.participants);
          break;
        case 'chat:broadcast':
          broadcastToRenderer(IPC_EVENT.chat, message.message);
          break;
        case 'chat:history':
          broadcastToRenderer(IPC_EVENT.history, message.messages);
          break;
        case 'chat:attachment':
          broadcastToRenderer(IPC_EVENT.attachment, {
            messageId: message.messageId,
            dataUrl: message.dataUrl,
          });
          break;
        case 'rtc:offer':
        case 'rtc:answer':
        case 'rtc:ice':
        case 'rtc:streams':
          broadcastToRenderer(IPC_EVENT.signal, toIncomingSignal(message));
          break;
        case 'screenshare:started':
          sharers.add(message.fromId);
          broadcastToRenderer(IPC_EVENT.screenShare, [...sharers]);
          break;
        case 'screenshare:stopped':
          sharers.delete(message.fromId);
          broadcastToRenderer(IPC_EVENT.screenShare, [...sharers]);
          break;
      }
    },
    onClosed: (reason) => {
      session = null;
      broadcastToRenderer(IPC_EVENT.disconnected, reason);
    },
    onError: (detail) => broadcastToRenderer(IPC_EVENT.error, detail),
  });

  try {
    await guest.connect(invite.host, invite.port, invite.token, options.username);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  session = { role: 'guest', guest };

  if (!accepted) {
    return { ok: false, error: 'host não confirmou a entrada' };
  }

  const { selfId, participants, screenSharerIds } = accepted;
  return {
    ok: true,
    // Blindagem: um campo faltando aqui vira exceção no React e tela preta.
    data: {
      selfId,
      participants: participants ?? [],
      screenSharerIds: screenSharerIds ?? [],
    },
  };
}

// ---------------------------------------------------------------------------
// Ações comuns
// ---------------------------------------------------------------------------

function sendChat(payload: ChatPayload): void {
  if (!session) return;
  const { text, attachment } = normalizeChatPayload(payload);
  if (session.role === 'host') session.host?.sendChatFromHost(text, attachment);
  else session.guest?.send({ type: 'chat:send', text, attachment });
}

/**
 * Imagem antiga sob demanda. O host lê do próprio disco; o convidado pede ao
 * host e a resposta chega pelo evento.
 */
function requestAttachment(messageId: string): void {
  if (!session) return;
  if (session.role === 'host') {
    broadcastToRenderer(IPC_EVENT.attachment, {
      messageId,
      dataUrl: attachmentDataUrl(messageId),
    });
    return;
  }
  session.guest?.send({ type: 'chat:attachment', messageId });
}

/** Aceita o formato antigo (string) para não quebrar nada que ainda o use. */
function normalizeChatPayload(payload: ChatPayload): {
  text: string;
  attachment?: OutgoingAttachment;
} {
  if (typeof payload === 'string') return { text: payload };
  return { text: payload.text ?? '', attachment: payload.attachment };
}

/**
 * A retenção roda de hora em hora — não a cada mensagem, que reescreveria o
 * arquivo inteiro à toa.
 */
let retentionTimer: NodeJS.Timeout | null = null;

function startRetentionTimer(): void {
  stopRetentionTimer();
  retentionTimer = setInterval(
    () => {
      const { chat } = loadSettings();
      if (!chat.saveHistory) return;
      pruneMessages(chat.retentionDays);
      pruneConversations(chat.conversationRetentionDays);
    },
    60 * 60 * 1000,
  );
}

function stopRetentionTimer(): void {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
}

function sendSignal(payload: SignalPayload): void {
  if (!session) return;
  const { targetId, channel, sdp, candidate, streams } = payload;

  if (session.role === 'guest') {
    // Convidado não repassa mídia de ninguém, então nunca envia mapa de streams.
    if (candidate) session.guest?.send({ type: 'rtc:ice', targetId, channel, candidate });
    else if (sdp?.type === 'offer') session.guest?.send({ type: 'rtc:offer', targetId, channel, sdp });
    else if (sdp) session.guest?.send({ type: 'rtc:answer', targetId, channel, sdp });
    return;
  }

  const host = session.host;
  if (!host) return;
  if (streams) host.sendSignal(targetId, { type: 'rtc:streams', fromId: host.hostId, channel, streams });
  else if (candidate) host.sendSignal(targetId, { type: 'rtc:ice', fromId: host.hostId, channel, candidate });
  else if (sdp?.type === 'offer') host.sendSignal(targetId, { type: 'rtc:offer', fromId: host.hostId, channel, sdp });
  else if (sdp) host.sendSignal(targetId, { type: 'rtc:answer', fromId: host.hostId, channel, sdp });
}

function setScreenShare(active: boolean): void {
  if (!session) return;
  if (session.role === 'host') session.host?.setHostScreenShare(active);
  else session.guest?.send({ type: active ? 'screenshare:start' : 'screenshare:stop' });
}

function getScreenSources(): Promise<ScreenSource[]> {
  return listScreenSources();
}

/** Encerra tudo: sockets fechados e porta UPnP desmapeada. */
export async function disposeSession(): Promise<void> {
  const current = session;
  session = null;
  if (!current) return;

  if (current.role === 'host') {
    await current.host?.stop();
    stopRetentionTimer();
    closeConversation();
    await unmapPort();
  } else {
    current.guest?.disconnect();
  }
}

// ---------------------------------------------------------------------------

function toIncomingSignal(
  message: Extract<ServerMessage, { type: `rtc:${string}` }>,
): IncomingSignal {
  if (message.type === 'rtc:streams') {
    return {
      fromId: message.fromId,
      channel: message.channel,
      kind: 'streams',
      streams: message.streams,
    };
  }
  if (message.type === 'rtc:ice') {
    return {
      fromId: message.fromId,
      channel: message.channel,
      kind: 'ice',
      candidate: message.candidate,
    };
  }
  return {
    fromId: message.fromId,
    channel: message.channel,
    kind: message.type === 'rtc:offer' ? 'offer' : 'answer',
    sdp: message.sdp,
  };
}

function describePortError(error: unknown, port: number): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('EADDRINUSE')) {
    return `a porta ${port} já está em uso — escolha outra`;
  }
  if (message.includes('EACCES')) {
    return `sem permissão para usar a porta ${port} — tente uma acima de 1024`;
  }
  return message;
}

type OutgoingAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
};

type ChatPayload = string | { text?: string; attachment?: OutgoingAttachment };
