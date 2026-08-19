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
import { notifyChat } from '../notify';
import { registerShortcuts } from '../shortcuts';
import { globalShortcut } from 'electron';
import type { SettingsPatch } from '../../shared/ipc';
import { HostServer } from '../network/hostServer';
import { GuestClient } from '../network/guestClient';
import { mapPort, unmapPort, type PortMappingResult } from '../network/upnp';
import { startTunnel, stopTunnel } from '../network/tunnel';
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
  ReconnectStatus,
  Role,
  ScreenSource,
  SignalPayload,
} from '../../shared/ipc';
import type { LastSession } from '../../shared/settings';
import { ChatMessage, Participant, RoomFeatures, ServerMessage } from '../../shared/protocol';
import {
  InviteInfo,
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

// ---------------------------------------------------------------------------
// Volta automática depois de uma queda
// ---------------------------------------------------------------------------

/**
 * O que basta para refazer exatamente a mesma sala. Os dois lados se ajudam: o
 * host reabre com o *mesmo token e a mesma porta*, então o convite que os
 * convidados já têm continua valendo e a tentativa silenciosa deles casa com a
 * volta dele — ninguém precisa recolher código nem combinar nada por fora.
 */
type ReconnectPlan =
  | {
      role: 'host';
      label: string;
      username: string;
      port: number;
      token: string;
      conversationId?: string;
    }
  | { role: 'guest'; label: string; username: string; invite: string };

/**
 * Espera crescente: as primeiras tentativas são quase imediatas (o caso comum é
 * um tropeço de Wi-Fi de dois segundos) e depois espaçam, dando tempo do host
 * reabrir o app sem que a gente desista antes dele voltar.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 20_000, 30_000, 30_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/** Quanto tempo uma sala caída ainda vale um "quer voltar?" na tela inicial. */
const LAST_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

let plan: ReconnectPlan | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let attempt = 0;
let retryReason = '';
let retrying = false;

/**
 * Cada socket carrega o número da sessão que o criou: um cliente antigo que
 * fecha tarde não pode derrubar a sessão que já voltou.
 */
let generation = 0;

function emitReconnect(status: ReconnectStatus): void {
  broadcastToRenderer(IPC_EVENT.reconnect, status);
}

/** Grava a sala no disco — é o que a tela inicial lê para oferecer a volta. */
function rememberSession(dropped: boolean, reason?: string): void {
  if (!plan) return;
  const last: LastSession = {
    role: plan.role,
    label: plan.label,
    invite: plan.role === 'guest' ? plan.invite : '',
    username: plan.username,
    conversationId: plan.role === 'host' ? plan.conversationId : undefined,
    port: plan.role === 'host' ? plan.port : undefined,
    token: plan.role === 'host' ? plan.token : undefined,
    endedAt: Date.now(),
    dropped,
    reason,
  };
  updateSettings({ app: { lastSession: last } });
}

function planFromLastSession(last: LastSession): ReconnectPlan | null {
  if (last.role === 'guest') {
    if (!last.invite) return null;
    return { role: 'guest', label: last.label, username: last.username, invite: last.invite };
  }
  if (!last.port || !last.token) return null;
  return {
    role: 'host',
    label: last.label,
    username: last.username,
    port: last.port,
    token: last.token,
    conversationId: last.conversationId,
  };
}

function clearRetryTimer(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/** Desiste da volta sem apagar o rastro: usado ao abrir uma sala nova. */
function forgetPlan(): void {
  clearRetryTimer();
  plan = null;
  attempt = 0;
  retrying = false;
  retryReason = '';
}

/**
 * O socket caiu sem ninguém ter pedido. A tela da sala continua de pé: quem
 * estava conversando não perde o histórico nem a lista de quem estava lá.
 */
function handleDrop(reason: string, from: number): void {
  if (from !== generation) return; // eco de uma sessão antiga
  session = null;

  const autoReconnect = loadSettings().app.autoReconnect;
  rememberSession(true, reason);

  if (!plan || !autoReconnect) {
    // Sem volta automática a sessão acabou aqui — mas a sala fica salva para o
    // convite da tela inicial.
    plan = null;
    broadcastToRenderer(IPC_EVENT.disconnected, reason);
    return;
  }

  attempt = 0;
  retryReason = reason;
  scheduleRetry();
}

function scheduleRetry(): void {
  if (!plan) return;
  const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  clearRetryTimer();
  emitReconnect({
    state: 'retrying',
    attempt: attempt + 1,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: Date.now() + delay,
    reason: retryReason,
    label: plan.label,
  });
  retryTimer = setTimeout(() => void runRetry(), delay);
}

/** Uma tentativa. Devolve `true` quando a sala voltou. */
async function runRetry(): Promise<boolean> {
  if (!plan || retrying) return false;
  clearRetryTimer();
  retrying = true;
  attempt += 1;

  const current = plan;
  emitReconnect({
    state: 'connecting',
    attempt,
    maxAttempts: MAX_ATTEMPTS,
    reason: retryReason,
    label: current.label,
  });

  try {
    const result = await (current.role === 'host'
      ? startHostSession(
          {
            username: current.username,
            port: current.port,
            conversationId: current.conversationId,
          },
          current.token,
        )
      : rejoin(current.invite, current.username));

    retrying = false;

    if (result.ok) {
      rememberSession(true, retryReason); // ainda "em aberto": só o leave limpa
      emitReconnect({
        state: 'reconnected',
        role: current.role,
        selfId: result.data.selfId,
        participants: result.data.participants,
        screenSharerIds: 'screenSharerIds' in result.data ? result.data.screenSharerIds : [],
        features: result.data.features,
      });
      return true;
    }
    retryReason = result.error;
  } catch (error) {
    retrying = false;
    retryReason = error instanceof Error ? error.message : String(error);
  }

  if (attempt >= MAX_ATTEMPTS) {
    giveUp(retryReason);
    return false;
  }
  scheduleRetry();
  return false;
}

function giveUp(reason: string): void {
  const label = plan?.label ?? '';
  rememberSession(true, reason);
  forgetPlan();
  emitReconnect({ state: 'failed', reason, label });
  broadcastToRenderer(IPC_EVENT.disconnected, reason);
}

/**
 * Tenta a volta agora: vale tanto para o botão "tentar de novo" do aviso na
 * sala quanto para o convite da tela inicial depois de o app ter fechado.
 */
async function reconnectNow(): Promise<ActionResult<null>> {
  if (!plan) {
    const last = loadSettings().app.lastSession;
    const rebuilt = last ? planFromLastSession(last) : null;
    if (!rebuilt) return { ok: false, error: 'não há sala recente para voltar' };
    plan = rebuilt;
    attempt = 0;
    retryReason = last?.reason ?? '';
    await disposeSession();
  }

  clearRetryTimer();
  // Um clique não gasta tentativa: quem está olhando a tela merece paciência.
  if (attempt > 0) attempt -= 1;

  const ok = await runRetry();
  return ok ? { ok: true, data: null } : { ok: false, error: retryReason };
}

/** O usuário preferiu voltar para a tela inicial. */
async function cancelReconnect(): Promise<void> {
  if (!plan) return;
  const reason = retryReason || 'você cancelou a volta';
  // Desistir é uma saída consciente: nada de insistir na próxima abertura.
  rememberSession(false, reason);
  const label = plan.label;
  forgetPlan();
  emitReconnect({ state: 'failed', reason, label });
}

function getLastSession(): LastSession | null {
  const last = loadSettings().app.lastSession;
  if (!last) return null;
  // Uma sala de ontem não interessa mais a ninguém.
  if (Date.now() - last.endedAt > LAST_SESSION_TTL_MS) return null;
  return last;
}

function forgetLastSession(): void {
  updateSettings({ app: { lastSession: null } });
}

/** Saída pedida pela pessoa: encerra de vez, sem volta automática. */
async function leaveSession(): Promise<void> {
  clearRetryTimer();
  rememberSession(false);
  forgetPlan();
  await disposeSession();
}

/** Reentra pelo código guardado — o mesmo que o host mantém válido. */
function rejoin(invite: string, username: string): Promise<ActionResult<JoinServerResult>> {
  const parsed = parseInvite(invite);
  if (!parsed) return Promise.resolve({ ok: false, error: 'o convite guardado não vale mais' });
  return startGuestSession(parsed, username);
}

function broadcastToRenderer(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    // A janela pode ser destruída entre a checagem e o envio; e um payload que
    // o Electron não consiga serializar lançaria daqui de dentro.
    try {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    } catch (error) {
      console.error('[only] falha ao avisar a interface:', error);
    }
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.createServer, (_event, options: CreateServerOptions) =>
    createServer(options),
  );
  ipcMain.handle(IPC.joinServer, (_event, options: JoinServerOptions) =>
    joinServer(options),
  );
  ipcMain.handle(IPC.leave, () => leaveSession());
  ipcMain.handle(IPC.reconnectNow, () => reconnectNow());
  ipcMain.handle(IPC.cancelReconnect, () => cancelReconnect());
  ipcMain.handle(IPC.getLastSession, () => getLastSession());
  ipcMain.handle(IPC.listJoinRequests, () =>
    session?.role === 'host' ? (session.host?.listJoinRequests() ?? []) : [],
  );
  ipcMain.handle(IPC.decideJoin, (_event, id: string, accept: boolean) =>
    session?.role === 'host' ? (session.host?.decideJoin(id, accept) ?? false) : false,
  );
  ipcMain.handle(IPC.forgetLastSession, () => forgetLastSession());
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
  // Abrir uma sala nova desiste da volta para a antiga.
  forgetPlan();
  await disposeSession();

  const result = await startHostSession(options, generateToken());
  if (result.ok) rememberSession(true, 'o app fechou no meio da conversa');
  return result;
}

/**
 * Sobe o servidor. O token vem de fora porque, na volta depois de uma queda,
 * ele precisa ser o *mesmo de antes*: é isso que mantém válido o convite que os
 * convidados já têm na mão.
 */
async function startHostSession(
  options: CreateServerOptions,
  token: string,
): Promise<ActionResult<CreateServerResult>> {
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
    onChat: (message: ChatMessage) => {
      broadcastToRenderer(IPC_EVENT.chat, message);
      notifyChat(message, host.hostId);
    },
    onSignal: (message) => broadcastToRenderer(IPC_EVENT.signal, toIncomingSignal(message)),
    onScreenShare: (sharerIds) => broadcastToRenderer(IPC_EVENT.screenShare, sharerIds),
    onJoinRequests: (requests) => broadcastToRenderer(IPC_EVENT.joinRequests, requests),
    onError: (detail) => broadcastToRenderer(IPC_EVENT.error, detail),
  }, {
    // Com a gravação desligada, a sala funciona igual — só não deixa rastro.
    persist: (message) => (loadSettings().chat.saveHistory ? appendMessage(message) : message),
    history: () => recentMessages(loadSettings().chat.historyOnJoin),
    attachment: (messageId) => attachmentDataUrl(messageId),
  }, () => loadSettings().security.approval, currentFeatures);

  try {
    await host.start(options.port);
  } catch (error) {
    return { ok: false, error: describePortError(error, options.port) };
  }

  session = { role: 'host', host };
  generation += 1;

  const localIp = resolveLocalIp() ?? '127.0.0.1';
  plan = {
    role: 'host',
    label: `${localIp}:${options.port}`,
    username: options.username,
    port: options.port,
    token,
    conversationId: currentConversationId() ?? options.conversationId,
  };

  // O host também vê a conversa que escolheu continuar.
  const history = recentMessages(chat.historyOnJoin);
  if (history.length > 0) {
    setTimeout(() => broadcastToRenderer(IPC_EVENT.history, history), 0);
  }

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
      // Ainda estamos falando com o roteador; a resposta chega por evento.
      portStatus: 'checking',
      features: currentFeatures(),
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

  /*
   * "Mapeado" não quer dizer "alcançável". Dois casos comuns de roteador que
   * responde "abri" e ninguém entra:
   *  - CGNAT: o IP que o roteador anuncia é privado (a operadora está no meio).
   *  - NAT duplo: o roteador com quem falamos não é o que tem o IP público —
   *    o IP que o mundo vê é outro, então a porta foi aberta no lugar errado.
   * Nos dois o convite direto nasce quebrado; melhor descobrir agora, sozinho,
   * do que o amigo do outro lado descobrir errando a entrada.
   */
  const doubleNat =
    mapping.status === 'mapped' &&
    !!publicIp &&
    !!mapping.routerExternalIp &&
    publicIp !== mapping.routerExternalIp;
  const directWorks = mapping.status === 'mapped' && !mapping.behindCarrierNat && !doubleNat;

  const detail = doubleNat
    ? `porta aberta no roteador ${mapping.routerExternalIp}, mas a internet chega por ${publicIp} — há outro roteador na frente`
    : mapping.detail;

  broadcastToRenderer(IPC_EVENT.connection, {
    inviteCode: directWorks && externalIp ? buildInviteCode({ host: externalIp, port, token }) : null,
    inviteUrl: directWorks && externalIp ? buildInviteUrl({ host: externalIp, port, token }) : null,
    publicIp: externalIp,
    portStatus: directWorks ? 'mapped' : network.useTunnel ? 'tunneling' : 'closed',
    portMappingDetail: detail,
    behindCarrierNat: mapping.behindCarrierNat,
  });

  if (directWorks || !network.useTunnel) return;
  await openTunnelFallback(port, token, externalIp, mapping.behindCarrierNat);
}

/**
 * Plano B: quando a porta não serve, sobe a ponte e troca o convite de internet
 * pelo endereço dela. A sala nunca cai por causa disto — quem já está dentro
 * pelo Wi-Fi continua conversando enquanto o túnel sobe.
 */
async function openTunnelFallback(
  port: number,
  token: string,
  publicIp: string | null,
  behindCarrierNat: boolean | undefined,
): Promise<void> {
  // Retrato do momento: se a pessoa fechar a sala e abrir outra enquanto a
  // ponte sobe, a resposta atrasada não pode contaminar a sala nova.
  const mine = generation;
  const stillMine = () => session?.role === 'host' && generation === mine;

  const hostname = await startTunnel(port, {
    onStage: (stage) => {
      if (!stillMine()) return;
      if (stage.stage === 'downloading') {
        broadcastToRenderer(IPC_EVENT.connection, {
          portStatus: 'tunneling',
          portMappingDetail: `preparando a ponte de internet (${stage.percent}%)`,
        });
      } else if (stage.stage === 'starting') {
        broadcastToRenderer(IPC_EVENT.connection, {
          portStatus: 'tunneling',
          portMappingDetail: 'abrindo a ponte de internet',
        });
      }
    },
  });

  // A sala pode ter fechado (ou virado outra) enquanto a ponte subia.
  if (!stillMine()) {
    if (hostname) await stopTunnel();
    return;
  }

  if (!hostname) {
    broadcastToRenderer(IPC_EVENT.connection, {
      inviteCode: null,
      inviteUrl: null,
      portStatus: 'closed',
      portMappingDetail: behindCarrierNat
        ? 'sua operadora usa CGNAT e a ponte de internet não subiu — pela internet, só com a porta liberada por outro caminho'
        : 'não consegui abrir a porta nem subir a ponte de internet',
      behindCarrierNat,
    });
    return;
  }

  broadcastToRenderer(IPC_EVENT.connection, {
    inviteCode: buildInviteCode({ host: hostname, port, token, secure: true }),
    inviteUrl: buildInviteUrl({ host: hostname, port, token, secure: true }),
    publicIp,
    portStatus: 'tunnel',
    portMappingDetail: `entrando pela ponte ${hostname} — não precisou mexer no roteador`,
    behindCarrierNat,
  });
}

// ---------------------------------------------------------------------------
// Convidado
// ---------------------------------------------------------------------------

async function joinServer(
  options: JoinServerOptions,
): Promise<ActionResult<JoinServerResult>> {
  forgetPlan();
  await disposeSession();

  const invite = parseInvite(options.invite);
  if (!invite) {
    return { ok: false, error: 'link de convite inválido — cole o código completo' };
  }

  const result = await startGuestSession(invite, options.username);
  if (result.ok) {
    plan = {
      role: 'guest',
      label: `${invite.host}:${invite.port}`,
      username: options.username,
      invite: options.invite.trim(),
    };
    rememberSession(true, 'o app fechou no meio da conversa');
  }
  return result;
}

async function startGuestSession(
  invite: InviteInfo,
  username: string,
): Promise<ActionResult<JoinServerResult>> {
  const mine = generation + 1;

  let accepted: Extract<ServerMessage, { type: 'join:accepted' }> | null = null;
  // O convidado acompanha quem está compartilhando; o host manda só as mudanças.
  const sharers = new Set<string>();

  const guest = new GuestClient({
    onPending: (reason) => broadcastToRenderer(IPC_EVENT.joinPending, reason),
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
          notifyChat(message.message, accepted?.selfId ?? null);
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
    onClosed: (reason) => handleDrop(reason, mine),
    onError: (detail) => broadcastToRenderer(IPC_EVENT.error, detail),
  });

  try {
    await guest.connect(invite, username);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  session = { role: 'guest', guest };
  generation = mine;

  if (!accepted) {
    return { ok: false, error: 'host não confirmou a entrada' };
  }

  const joined: Extract<ServerMessage, { type: 'join:accepted' }> = accepted;
  const { selfId, participants, screenSharerIds } = joined;
  // Host de versão antiga não anuncia nada: sala em estrela, sem cifra.
  const features: RoomFeatures = joined.features ?? { mesh: false, approval: false };
  return {
    ok: true,
    // Blindagem: um campo faltando aqui vira exceção no React e tela preta.
    data: {
      selfId,
      participants: participants ?? [],
      screenSharerIds: screenSharerIds ?? [],
      features,
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
 * O que a sala combina com quem entra. O host lê das próprias preferências; o
 * convidado obedece o que veio no aceite - decidir sozinho seria falar sozinho.
 */
function currentFeatures(): RoomFeatures {
  const settings = loadSettings();
  return {
    mesh: settings.network.mesh,
    approval: settings.security.approval === 'manual',
  };
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
    await Promise.all([unmapPort(), stopTunnel()]);
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
