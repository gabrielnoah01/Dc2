import type { Settings } from './settings';
import {
  ChatMessage,
  IceCandidate,
  Participant,
  RtcChannel,
  SessionDescription,
  StreamOwner,
} from './protocol';

/** Papel da instância. `null` = ainda na tela inicial. */
export type Role = 'host' | 'guest' | null;

export interface CreateServerOptions {
  username: string;
  port: number;
  /** Conversa a continuar. Ausente = começa uma nova. */
  conversationId?: string;
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
  /** Se o roteador aceitou abrir a porta sozinho. */
  portMapped: boolean;
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
} as const;

export const IPC_EVENT = {
  participants: 'event:participants',
  chat: 'event:chat',
  signal: 'event:signal',
  screenShare: 'event:screenshare',
  disconnected: 'event:disconnected',
  error: 'event:error',
  update: 'event:update',
  connection: 'event:connection',
  history: 'event:history',
  attachment: 'event:attachment',
  settings: 'event:settings',
  shortcut: 'event:shortcut',
} as const;

/** Estado da atualização, mostrado numa faixa no topo do app. */
export type UpdateStatus =
  | { state: 'idle'; version?: string }
  | { state: 'checking'; version?: string }
  | { state: 'downloading'; version?: string; percent: number }
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

  onParticipants(handler: (participants: Participant[]) => void): () => void;
  onChat(handler: (message: ChatMessage) => void): () => void;
  onHistory(handler: (messages: ChatMessage[]) => void): () => void;
  onAttachment(handler: (payload: { messageId: string; dataUrl: string | null }) => void): () => void;
  onSignal(handler: (signal: IncomingSignal) => void): () => void;
  onScreenShare(handler: (sharerIds: string[]) => void): () => void;
  onDisconnected(handler: (reason: string) => void): () => void;
  onError(handler: (detail: string) => void): () => void;
  onUpdate(handler: (status: UpdateStatus) => void): () => void;
  onSettings(handler: (settings: Settings) => void): () => void;
  onShortcut(handler: (action: ShortcutAction) => void): () => void;
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

export type SettingsPatch = {
  [K in keyof Settings]?: Partial<Settings[K]>;
};

/** O que descobrimos sobre a rede depois que o servidor já subiu. */
export interface ConnectionUpdate {
  inviteCode: string | null;
  inviteUrl: string | null;
  publicIp: string | null;
  portMapped: boolean;
  portMappingDetail?: string;
  behindCarrierNat?: boolean;
}
