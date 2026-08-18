import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import {
  Attachment,
  ClientMessage,
  ServerMessage,
  Participant,
  ChatMessage,
  parseMessage,
  serialize,
} from '../../shared/protocol';
import {
  MAX_CHAT_LENGTH,
  MAX_USERNAME_LENGTH,
  PROTOCOL_VERSION,
} from '../../shared/constants';

interface Connection {
  id: string;
  socket: WebSocket;
  username: string;
  joined: boolean;
}

/**
 * De onde o histórico vem e para onde vai. Injetado para o servidor não
 * depender do disco — assim ele continua testável sem tocar em arquivo.
 */
export interface ChatArchive {
  /** Grava e devolve a mensagem (com o anexo já normalizado). */
  persist(message: ChatMessage): ChatMessage;
  /** Últimas mensagens para quem acabou de entrar. */
  history(): ChatMessage[];
  /** Imagem cheia de uma mensagem antiga, sob demanda. */
  attachment(messageId: string): string | null;
}

export interface HostEvents {
  onParticipants(participants: Participant[]): void;
  onChat(message: ChatMessage): void;
  /** Sinalização vinda de um convidado, endereçada ao host. */
  onSignal(message: Extract<ServerMessage, { type: `rtc:${string}` }>): void;
  onScreenShare(sharerIds: string[]): void;
  onError(detail: string): void;
}

/** Quantas tentativas de token errado um mesmo IP pode fazer antes de esfriar. */
const MAX_BAD_ATTEMPTS = 5;
const BAD_ATTEMPT_WINDOW_MS = 60_000;

export class HostServer {
  private server: WebSocketServer | null = null;
  private readonly connections = new Map<string, Connection>();
  private readonly badAttempts = new Map<string, { count: number; first: number }>();
  /** Quem está compartilhando tela agora. Vários ao mesmo tempo é permitido. */
  private readonly screenSharers = new Set<string>();

  readonly hostId = randomUUID();

  constructor(
    private readonly token: string,
    private hostUsername: string,
    private readonly events: HostEvents,
    private readonly archive: ChatArchive,
  ) {}

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ host: '0.0.0.0', port });

      const onceFailed = (error: Error) => {
        server.close();
        reject(error);
      };

      server.once('error', onceFailed);
      server.once('listening', () => {
        server.off('error', onceFailed);
        server.on('error', (error) => this.events.onError(error.message));
        this.server = server;
        this.emitParticipants();
        resolve();
      });

      server.on('connection', (socket, request) => {
        this.handleConnection(socket, request.socket.remoteAddress ?? 'desconhecido');
      });
    });
  }

  async stop(): Promise<void> {
    for (const connection of this.connections.values()) {
      connection.socket.close(1001, 'servidor encerrado');
    }
    this.connections.clear();
    this.screenSharers.clear();

    const server = this.server;
    this.server = null;
    if (!server) return;

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  get isRunning(): boolean {
    return this.server !== null;
  }

  setHostUsername(username: string): void {
    this.hostUsername = sanitizeUsername(username);
    this.emitParticipants();
  }

  // -------------------------------------------------------------------------
  // Ações do próprio host (vindas do renderer via IPC)
  // -------------------------------------------------------------------------

  sendChatFromHost(text: string, attachment?: IncomingAttachment): void {
    const message = this.buildMessage(this.hostId, this.hostUsername, text, attachment);
    if (!message) return;
    this.archive.persist(message);
    this.broadcast({ type: 'chat:broadcast', message });
    this.events.onChat(message);
  }

  /**
   * Monta a mensagem validando texto e anexo. Devolve `null` quando não sobra
   * nada para enviar — mensagem vazia sem imagem não vira nada.
   */
  private buildMessage(
    fromId: string,
    username: string,
    text: unknown,
    attachment?: IncomingAttachment,
  ): ChatMessage | null {
    const clean = sanitizeChat(text);
    const image = sanitizeAttachment(attachment);
    if (!clean && !image) return null;

    return {
      id: randomUUID(),
      fromId,
      username,
      text: clean,
      ts: Date.now(),
      ...(image ? { attachment: image } : {}),
    };
  }

  /** Sinalização do host para um convidado específico. */
  sendSignal(
    targetId: string,
    message: Extract<ServerMessage, { type: `rtc:${string}` }>,
  ): void {
    this.sendTo(targetId, message);
  }

  setHostScreenShare(active: boolean): void {
    if (active) {
      this.screenSharers.add(this.hostId);
      this.broadcast({ type: 'screenshare:started', fromId: this.hostId });
    } else if (this.screenSharers.delete(this.hostId)) {
      this.broadcast({ type: 'screenshare:stopped', fromId: this.hostId });
    }
    this.events.onScreenShare([...this.screenSharers]);
  }

  // -------------------------------------------------------------------------
  // Conexões
  // -------------------------------------------------------------------------

  private handleConnection(socket: WebSocket, remoteAddress: string): void {
    const id = randomUUID();
    const connection: Connection = { id, socket, username: '', joined: false };
    this.connections.set(id, connection);
    log(`conexão recebida de ${remoteAddress}`);

    // Quem conecta e não faz `join` em 10s é descartado.
    const joinTimer = setTimeout(() => {
      if (!connection.joined) socket.close(4000, 'join não recebido');
    }, 10_000);

    socket.on('message', (raw) => {
      const message = parseMessage<ClientMessage>(raw.toString());
      if (!message) return;

      // Uma mensagem problemática de um convidado não pode derrubar a sala de
      // todo mundo. Sem esta barreira, qualquer exceção aqui sobe pelo emitter
      // do socket e mata o processo principal inteiro.
      try {
        this.handleMessage(connection, message, remoteAddress);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`erro ao tratar "${message.type}" de ${connection.username || remoteAddress}: ${detail}`);
        this.events.onError(
          `um problema com a mensagem de ${connection.username || 'alguém'} foi ignorado`,
        );
      }
    });

    socket.on('close', (code, reasonBuffer) => {
      try {
        clearTimeout(joinTimer);
        log(`${connection.username || remoteAddress} desconectou (código ${code} ${reasonBuffer.toString() || 'sem motivo'})`);
        this.connections.delete(id);
        if (this.screenSharers.delete(id)) {
          this.broadcast({ type: 'screenshare:stopped', fromId: id });
          this.events.onScreenShare([...this.screenSharers]);
        }
        if (connection.joined) this.emitParticipants();
      } catch (error) {
        log(`erro ao desconectar ${remoteAddress}: ${String(error)}`);
      }
    });

    socket.on('error', (error) => {
      log(`erro no socket de ${remoteAddress}: ${error.message}`);
      socket.close();
    });
  }

  private handleMessage(
    connection: Connection,
    message: ClientMessage,
    remoteAddress: string,
  ): void {
    if (!connection.joined && message.type !== 'join') return;

    switch (message.type) {
      case 'join':
        this.handleJoin(connection, message, remoteAddress);
        break;

      case 'chat:send': {
        const chat = this.buildMessage(
          connection.id,
          connection.username,
          message.text,
          message.attachment,
        );
        if (!chat) return;
        this.archive.persist(chat);
        this.broadcast({ type: 'chat:broadcast', message: chat });
        this.events.onChat(chat);
        break;
      }

      case 'chat:attachment':
        this.sendTo(connection.id, {
          type: 'chat:attachment',
          messageId: message.messageId,
          dataUrl: this.archive.attachment(message.messageId),
        });
        break;

      case 'rtc:offer':
      case 'rtc:answer':
      case 'rtc:ice':
        this.relaySignal(connection, message);
        break;

      case 'screenshare:start':
        if (this.screenSharers.has(connection.id)) return;
        this.screenSharers.add(connection.id);
        this.broadcast({ type: 'screenshare:started', fromId: connection.id });
        this.events.onScreenShare([...this.screenSharers]);
        break;

      case 'screenshare:stop':
        if (!this.screenSharers.delete(connection.id)) return;
        this.broadcast({ type: 'screenshare:stopped', fromId: connection.id });
        this.events.onScreenShare([...this.screenSharers]);
        break;

      case 'leave':
        connection.socket.close(1000, 'saiu');
        break;
    }
  }

  private handleJoin(
    connection: Connection,
    message: Extract<ClientMessage, { type: 'join' }>,
    remoteAddress: string,
  ): void {
    if (connection.joined) return;

    // Versão diferente fala outro dialeto: recusar com explicação é muito
    // melhor do que aceitar e quebrar em alguma mensagem lá na frente.
    if (message.protocol !== PROTOCOL_VERSION) {
      const theirs = message.protocol ?? 1;
      this.reject(
        connection,
        theirs < PROTOCOL_VERSION
          ? 'seu Only está desatualizado — atualize para entrar neste servidor'
          : 'o Only do host está desatualizado — peça para ele atualizar',
      );
      return;
    }

    if (this.isRateLimited(remoteAddress)) {
      this.reject(connection, 'muitas tentativas — tente novamente em um minuto');
      return;
    }

    if (message.token !== this.token) {
      this.registerBadAttempt(remoteAddress);
      this.reject(connection, 'token inválido');
      return;
    }

    const username = sanitizeUsername(message.username);
    if (!username) {
      this.reject(connection, 'nome de usuário inválido');
      return;
    }

    this.badAttempts.delete(remoteAddress);
    connection.username = this.ensureUniqueUsername(username, connection.id);
    connection.joined = true;
    log(`${connection.username} entrou`);

    this.sendTo(connection.id, {
      type: 'join:accepted',
      protocol: PROTOCOL_VERSION,
      selfId: connection.id,
      participants: this.participants(),
      screenSharerIds: [...this.screenSharers],
    });

    // Histórico depois do aceite: o cliente já tem a sala montada para receber.
    const history = this.archive.history();
    if (history.length > 0) {
      this.sendTo(connection.id, { type: 'chat:history', messages: history });
    }

    this.emitParticipants();
  }

  private reject(connection: Connection, reason: string): void {
    log(`entrada recusada: ${reason}`);
    connection.socket.send(serialize({ type: 'join:rejected', reason }));
    // Fecha imediatamente: sem retry na mesma conexão.
    connection.socket.close(4001, reason);
    this.connections.delete(connection.id);
  }

  private relaySignal(
    connection: Connection,
    message: Extract<ClientMessage, { type: `rtc:${string}` }>,
  ): void {
    const payload = { ...message, fromId: connection.id } as unknown as Extract<
      ServerMessage,
      { type: `rtc:${string}` }
    >;
    delete (payload as { targetId?: string }).targetId;

    if (message.targetId === this.hostId) {
      this.events.onSignal(payload);
      return;
    }
    this.sendTo(message.targetId, payload);
  }

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  /** Snapshot para a UI do host logo ao criar o servidor (ele já é participante). */
  getParticipants(): Participant[] {
    return this.participants();
  }

  private participants(): Participant[] {
    const list: Participant[] = [
      { id: this.hostId, username: this.hostUsername, isHost: true },
    ];
    for (const connection of this.connections.values()) {
      if (connection.joined) {
        list.push({ id: connection.id, username: connection.username, isHost: false });
      }
    }
    return list;
  }

  private emitParticipants(): void {
    const participants = this.participants();
    this.broadcast({ type: 'presence:update', participants });
    this.events.onParticipants(participants);
  }

  private ensureUniqueUsername(username: string, selfId: string): string {
    const taken = new Set<string>([this.hostUsername.toLowerCase()]);
    for (const connection of this.connections.values()) {
      if (connection.joined && connection.id !== selfId) {
        taken.add(connection.username.toLowerCase());
      }
    }
    if (!taken.has(username.toLowerCase())) return username;

    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${username} (${suffix})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${username} (${selfId.slice(0, 4)})`;
  }

  private broadcast(message: ServerMessage, exceptId?: string): void {
    const data = serialize(message);
    for (const connection of this.connections.values()) {
      if (!connection.joined || connection.id === exceptId) continue;
      if (connection.socket.readyState !== WebSocket.OPEN) continue;
      // Um socket que morreu entre a checagem e o envio não pode interromper
      // a entrega para os demais.
      try {
        connection.socket.send(data);
      } catch (error) {
        log(`falha ao enviar para ${connection.username}: ${String(error)}`);
      }
    }
  }

  private sendTo(id: string, message: ServerMessage): void {
    const connection = this.connections.get(id);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) return;
    try {
      connection.socket.send(serialize(message));
    } catch (error) {
      log(`falha ao enviar para ${connection.username}: ${String(error)}`);
    }
  }

  private isRateLimited(address: string): boolean {
    const entry = this.badAttempts.get(address);
    if (!entry) return false;
    if (Date.now() - entry.first > BAD_ATTEMPT_WINDOW_MS) {
      this.badAttempts.delete(address);
      return false;
    }
    return entry.count >= MAX_BAD_ATTEMPTS;
  }

  private registerBadAttempt(address: string): void {
    const entry = this.badAttempts.get(address);
    if (!entry || Date.now() - entry.first > BAD_ATTEMPT_WINDOW_MS) {
      this.badAttempts.set(address, { count: 1, first: Date.now() });
      return;
    }
    entry.count += 1;
  }
}

/** Log do servidor — aparece no terminal do `npm run dev` e ajuda a diagnosticar
 *  entradas recusadas sem precisar adivinhar. */
function log(message: string): void {
  console.log(`[only:host] ${message}`);
}

function sanitizeUsername(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_USERNAME_LENGTH);
}

/** O que chega do cliente, antes de virar `Attachment` de verdade. */
type IncomingAttachment = {
  name?: unknown;
  mimeType?: unknown;
  dataUrl?: unknown;
  width?: unknown;
  height?: unknown;
};

/** Formatos que aceitamos exibir. Nada de SVG: ele executa script. */
const ALLOWED_IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);

/** Teto duro no servidor, independente do que o cliente diga ter comprimido. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function sanitizeAttachment(value: IncomingAttachment | undefined): Attachment | null {
  if (!value || typeof value.dataUrl !== 'string') return null;

  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '';
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) return null;
  if (!value.dataUrl.startsWith(`data:${mimeType};base64,`)) return null;

  // base64 ocupa ~4/3 do original; estimar evita decodificar só para medir.
  const base64Length = value.dataUrl.length - value.dataUrl.indexOf(',') - 1;
  const size = Math.floor((base64Length * 3) / 4);
  if (size <= 0 || size > MAX_ATTACHMENT_BYTES) return null;

  return {
    id: randomUUID(),
    name: typeof value.name === 'string' ? value.name.slice(0, 120) : 'imagem',
    mimeType,
    size,
    width: toDimension(value.width),
    height: toDimension(value.height),
    dataUrl: value.dataUrl,
  };
}

function toDimension(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function sanitizeChat(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_CHAT_LENGTH);
}
