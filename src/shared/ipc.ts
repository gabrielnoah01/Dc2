import type { ApprovalMode, LastSession, Settings } from './settings';
import {
  ChatMessage,
  IceCandidate,
  Participant,
  RtcChannel,
  SessionDescription,
  StreamOwner,
  RoomFeatures,
} from './protocol';

export type { ApprovalMode };

/**
 * Alguém esperando o host abrir a porta. Só existe quando a sala está em
 * aprovação manual.
 */
export interface JoinRequest {
  /** Id da conexão — é o mesmo que vira id de participante se for aceito. */
  id: string;
  username: string;
  requestedAt: number;
}

/** Papel da instância. `null` = ainda na tela inicial. */
export type Role = 'host' | 'guest' | null;

export interface CreateServerOptions {
  username: string;
  port: number;
  /** Conversa a continuar. Ausente = começa uma nova. */
  conversationId?: string;
  /**
   * Reabrir a sala com o token antigo. Sem isso todo convite já distribuído
   * morre junto com a queda do host — é o que permite os convidados voltarem
   * sozinhos, sem ninguém recolar código.
   */
  token?: string;
}

export interface CreateServerResult {
  selfId: string;
  port: number;
  token: string;
  /** O host também é participante — a sala nunca aparece vazia para ele. */
  participants: Participant[];
  /** Código curto com IP público, quando descoberto. */
  inviteCode: string | null;
  inviteUrl: string | null;
  /** Código curto com IP local — sempre funciona na mesma rede Wi-Fi. */
  localInviteCode: string;
  publicIp: string | null;
  localIp: string;
  /** Como está a abertura da porta no roteador. */
  portStatus: PortStatus;
  /** O que a sala combinou (malha, cifra, aprovação). */
  features: RoomFeatures;
  portMappingDetail?: string;
  /** Operadora usa CGNAT: nem port-forward resolve, só rede local ou túnel. */
  behindCarrierNat?: boolean;
}

export interface JoinServerOptions {
  /** Código curto ou URI — o parse aceita os dois. */
  invite: string;
  username: string;
}

export interface JoinServerResult {
  selfId: string;
  participants: Participant[];
  screenSharerIds: string[];
  /** O que a sala combinou: quem entra obedece o host, não a própria caixa. */
  features: RoomFeatures;
}

export interface SignalPayload {
  targetId: string;
  channel: RtcChannel;
  sdp?: SessionDescription;
  candidate?: IceCandidate;
  /** Só o host envia: de quem é cada stream que ele está repassando. */
  streams?: StreamOwner[];
}

export interface IncomingSignal {
  fromId: string;
  channel: RtcChannel;
  kind: 'offer' | 'answer' | 'ice' | 'streams';
  sdp?: SessionDescription;
  candidate?: IceCandidate;
  streams?: StreamOwner[];
}

/** Resultado padrão das ações que podem falhar de forma esperada. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const IPC = {
  createServer: 'session:create-server',
  joinServer: 'session:join-server',
  leave: 'session:leave',
  reconnectNow: 'session:reconnect-now',
  cancelReconnect: 'session:reconnect-cancel',
  getLastSession: 'session:last',
  forgetLastSession: 'session:last-forget',
  sendChat: 'chat:send',
  sendSignal: 'rtc:signal',
  setScreenShare: 'screenshare:set',
  getScreenSources: 'screenshare:sources',
  selectScreenSource: 'screenshare:select-source',
  checkUpdate: 'update:check',
  installUpdate: 'update:install',
  requestAttachment: 'chat:request-attachment',
  listConversations: 'chat:list-conversations',
  deleteConversation: 'chat:delete-conversation',
  clearConversation: 'chat:clear-conversation',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  resetSettings: 'settings:reset',
  testShortcut: 'settings:test-shortcut',
  decideJoin: 'session:decide-join',
  listJoinRequests: 'session:join-requests',
} as const;

export const IPC_EVENT = {
  participants: 'event:participants',
  chat: 'event:chat',
  signal: 'event:signal',
  screenShare: 'event:screenshare',
  disconnected: 'event:disconnected',
  reconnect: 'event:reconnect',
  error: 'event:error',
  update: 'event:update',
  connection: 'event:connection',
  history: 'event:history',
  attachment: 'event:attachment',
  settings: 'event:settings',
  shortcut: 'event:shortcut',
  joinRequests: 'event:join-requests',
  joinPending: 'event:join-pending',
  windowActivity: 'event:window-activity',
} as const;

/**
 * Andamento da volta automática depois de uma queda. Enquanto isso a tela da
 * sala continua de pé: quem estava conversando não perde o histórico nem a
 * lista de quem estava lá, e a volta é silenciosa quando dá certo de primeira.
 */
export type ReconnectStatus =
  | { state: 'idle' }
  | {
      state: 'retrying';
      /** Tentativa atual, contando da primeira. */
      attempt: number;
      maxAttempts: number;
      /** Quando a próxima tentativa dispara (epoch ms) — para o contador na tela. */
      nextAttemptAt: number;
      /** Motivo da queda, em português de gente. */
      reason: string;
      label: string;
    }
  | { state: 'connecting'; attempt: number; maxAttempts: number; reason: string; label: string }
  | {
      state: 'reconnected';
      role: Exclude<Role, null>;
      selfId: string;
      participants: Participant[];
      screenSharerIds: string[];
      /** A sala pode ter voltado com outro combinado: malha, cifra, aprovação. */
      features: RoomFeatures;
    }
  /** Desistimos (ou o usuário cancelou): agora sim a sessão acabou. */
  | { state: 'failed'; reason: string; label: string };

/** Estado da atualização, mostrado numa faixa no topo do app. */
export type UpdateStatus =
  | { state: 'idle'; version?: string }
  | { state: 'checking'; version?: string }
  | {
      state: 'downloading';
      version?: string;
      percent: number;
      /** Bytes por segundo, para mostrar a velocidade real. */
      speed?: number;
      transferred?: number;
      total?: number;
    }
  | { state: 'ready'; version?: string }
  | { state: 'unavailable'; version?: string; detail?: string };

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  /** Separa as abas "Telas" e "Janelas" no picker. */
  kind: 'screen' | 'window';
  /** Ícone do app, quando o Chromium sabe qual é (só janelas). */
  appIcon: string | null;
}

/** Superfície exposta ao renderer pelo preload. */
export interface OnlyApi {
  createServer(options: CreateServerOptions): Promise<ActionResult<CreateServerResult>>;
  joinServer(options: JoinServerOptions): Promise<ActionResult<JoinServerResult>>;
  leave(): Promise<void>;
  /** Tenta a volta agora, sem esperar o cronômetro (ou depois de desistir). */
  reconnectNow(): Promise<ActionResult<null>>;
  /** Para de tentar: a pessoa prefere voltar para a tela inicial. */
  cancelReconnect(): Promise<void>;
  /** A última sala, para oferecer a volta assim que o app abre. */
  getLastSession(): Promise<LastSession | null>;
  forgetLastSession(): Promise<void>;
  sendChat(payload: ChatPayload): Promise<void>;
  /** Pede a imagem cheia de uma mensagem antiga do histórico. */
  requestAttachment(messageId: string): Promise<void>;
  listConversations(): Promise<ConversationSummary[]>;
  deleteConversation(id: string): Promise<void>;
  /** Apaga as mensagens mas mantém a conversa. */
  clearConversation(id: string): Promise<void>;
  sendSignal(payload: SignalPayload): Promise<void>;
  setScreenShare(active: boolean): Promise<void>;
  getScreenSources(): Promise<ScreenSource[]>;
  /** Arma a fonte que o próximo `getDisplayMedia()` deve devolver. */
  selectScreenSource(sourceId: string): Promise<boolean>;
  checkUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;

  getSettings(): Promise<Settings>;
  /** Patch parcial: manda só a seção alterada. */
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  resetSettings(): Promise<Settings>;
  /** Confere se um atalho pode ser registrado; devolve o conflito, se houver. */
  testShortcut(accelerator: string): Promise<{ ok: boolean; detail?: string }>;

  /** Resposta do host a quem bateu na porta. `false` = o pedido já sumiu. */
  decideJoin(id: string, accept: boolean): Promise<boolean>;
  /** Fila atual, para a tela do host já abrir com o que está pendente. */
  listJoinRequests(): Promise<JoinRequest[]>;

  onParticipants(handler: (participants: Participant[]) => void): () => void;
  onChat(handler: (message: ChatMessage) => void): () => void;
  onHistory(handler: (messages: ChatMessage[]) => void): () => void;
  onAttachment(handler: (payload: { messageId: string; dataUrl: string | null }) => void): () => void;
  onSignal(handler: (signal: IncomingSignal) => void): () => void;
  onScreenShare(handler: (sharerIds: string[]) => void): () => void;
  onDisconnected(handler: (reason: string) => void): () => void;
  onReconnect(handler: (status: ReconnectStatus) => void): () => void;
  onError(handler: (detail: string) => void): () => void;
  onUpdate(handler: (status: UpdateStatus) => void): () => void;
  onSettings(handler: (settings: Settings) => void): () => void;
  onShortcut(handler: (action: ShortcutAction) => void): () => void;
  /** Estado da janela, para o renderer parar de trabalhar quando ninguém olha. */
  onWindowActivity(handler: (activity: WindowActivityState) => void): () => void;
  /** Só o host recebe: quem está esperando aprovação neste instante. */
  onJoinRequests(handler: (requests: JoinRequest[]) => void): () => void;
  /** Só o convidado recebe: o host precisa aprovar, aguarde. */
  onJoinPending(handler: (reason: string) => void): () => void;
  /** Dados de rede que chegam depois da sala abrir (UPnP, IP público). */
  onConnection(handler: (info: ConnectionUpdate) => void): () => void;
}

/** Imagem já comprimida pelo remetente, pronta para viajar. */
export interface OutgoingAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
}

export type ChatPayload = { text: string; attachment?: OutgoingAttachment };

/** Uma conversa salva no disco do host. */
export interface ConversationSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  attachmentBytes: number;
}

/** Ações disparadas pelos atalhos globais. */
export type ShortcutAction = 'toggle-mute' | 'toggle-deafen' | 'ptt-down' | 'ptt-up';

/**
 * O quanto a janela está sendo olhada.
 *
 * Vem do processo principal em vez de `document.visibilityState` porque o
 * renderer não distingue os casos que importam: minimizada, escondida na
 * bandeja e "aberta atrás de outra janela" chegam todas como a mesma coisa, e
 * a economia que vale a pena fazer em cada uma é diferente.
 */
export type WindowActivityState = 'active' | 'background' | 'hidden';

export type SettingsPatch = {
  [K in keyof Settings]?: Partial<Settings[K]>;
};

/** O que descobrimos sobre a rede depois que o servidor já subiu. */
export interface ConnectionUpdate {
  inviteCode: string | null;
  inviteUrl: string | null;
  publicIp: string | null;
  portStatus: PortStatus;
  portMappingDetail?: string;
  behindCarrierNat?: boolean;
}

/**
 * `checking` é essencial: falar com o roteador leva segundos, e mostrar
 * "não consegui abrir a porta" enquanto a tentativa ainda está em curso faz o
 * usuário desistir de algo que ia funcionar.
 */
/**
 * Como o mundo de fora chega até a sala.
 *  - `checking`: ainda falando com o roteador.
 *  - `mapped`:   porta aberta, caminho direto.
 *  - `tunneling`: sem porta; preparando a ponte (pode estar baixando).
 *  - `tunnel`:   ponte de pé, o convite de internet é o endereço dela.
 *  - `closed`:   sem porta e sem ponte — só rede local.
 */
export type PortStatus = 'checking' | 'mapped' | 'tunneling' | 'tunnel' | 'closed';
