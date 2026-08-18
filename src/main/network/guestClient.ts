import { WebSocket } from 'ws';
import {
  ClientMessage,
  ServerMessage,
  parseMessage,
  serialize,
} from '../../shared/protocol';
import { PROTOCOL_VERSION } from '../../shared/constants';

export interface GuestEvents {
  onMessage(message: ServerMessage): void;
  onClosed(reason: string): void;
  onError(detail: string): void;
}

/**
 * Cliente WebSocket do convidado. Vive no main (não no renderer) para manter a
 * regra do projeto: JSON de rede só no processo Node; o renderer cuida apenas
 * de mídia via WebRTC.
 */
export class GuestClient {
  private socket: WebSocket | null = null;
  private closedByUser = false;

  constructor(private readonly events: GuestEvents) {}

  connect(host: string, port: number, token: string, username: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const address = formatAddress(host, port);
      const socket = new WebSocket(address, { handshakeTimeout: 8000 });
      this.socket = socket;
      this.closedByUser = false;

      let settled = false;

      socket.on('open', () => {
        this.send({ type: 'join', token, username, protocol: PROTOCOL_VERSION });
      });

      socket.on('message', (raw) => {
        const message = parseMessage<ServerMessage>(raw.toString());
        if (!message) return;

        // A conexão só é considerada boa depois que o host aceita o token.
        if (!settled) {
          if (message.type === 'join:accepted') {
            settled = true;
            // O host também precisa falar a nossa versão. Sem esta checagem,
            // um host antigo é aceito e a sessão quebra depois, na primeira
            // mensagem com formato diferente.
            if (message.protocol !== PROTOCOL_VERSION) {
              this.closedByUser = true;
              socket.close();
              reject(
                new Error(
                  (message.protocol ?? 1) < PROTOCOL_VERSION
                    ? 'o Only do host está desatualizado — peça para ele atualizar'
                    : 'seu Only está desatualizado — atualize para entrar neste servidor',
                ),
              );
              return;
            }
            resolve();
          } else if (message.type === 'join:rejected') {
            settled = true;
            this.closedByUser = true;
            socket.close();
            reject(new Error(message.reason));
            return;
          }
        }

        // Uma mensagem inesperada (host de outra versão) não pode derrubar o
        // processo principal — isso fecha o app inteiro sem explicação.
        try {
          this.events.onMessage(message);
        } catch (error) {
          this.events.onError(
            `mensagem que não entendi vinda do host: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });

      socket.on('error', (error) => {
        if (!settled) {
          settled = true;
          reject(new Error(describeConnectionError(error)));
          return;
        }
        this.events.onError(error.message);
      });

      socket.on('close', (code, reasonBuffer) => {
        const reason = describeClose(code, reasonBuffer.toString(), settled);
        this.socket = null;
        if (!settled) {
          settled = true;
          reject(new Error(reason));
          return;
        }
        if (!this.closedByUser) this.events.onClosed(reason);
      });
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(serialize(message));
  }

  disconnect(): void {
    if (!this.socket) return;
    this.closedByUser = true;
    this.send({ type: 'leave' });
    this.socket.close(1000, 'saiu');
    this.socket = null;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

function formatAddress(host: string, port: number): string {
  // IPv6 literal precisa de colchetes na URL.
  const needsBrackets = host.includes(':') && !host.startsWith('[');
  const target = needsBrackets ? `[${host}]` : host;
  return `ws://${target}:${port}`;
}

/**
 * Traduz o fechamento do socket em algo acionável. Sem isso todo problema vira
 * "conexão encerrada", que não diz se foi firewall, token velho ou host fechado.
 */
function describeClose(code: number, reason: string, wasConnected: boolean): string {
  if (reason) return reason;

  switch (code) {
    case 1000:
      return wasConnected ? 'o host encerrou o servidor' : 'o host recusou a conexão';
    case 1001:
      return 'o host fechou o servidor';
    case 1006:
      // Nenhum frame de close chegou: a conexão morreu no meio do caminho.
      return wasConnected
        ? 'a conexão caiu (rede instável ou o app do host foi fechado)'
        : 'não deu para falar com o host — porta bloqueada pelo firewall do PC dele, ' +
          'ou o servidor não está mais aberto (código 1006)';
    case 4000:
      return 'o host desistiu de esperar a entrada';
    case 4001:
      return 'o host recusou a entrada — o código de convite provavelmente é de outra sessão';
    default:
      return `conexão encerrada pelo host (código ${code})`;
  }
}

function describeConnectionError(error: Error): string {
  const message = error.message;
  if (message.includes('ECONNREFUSED')) {
    return 'servidor não respondeu — confirme se o host está com o app aberto e a porta liberada';
  }
  if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
    return 'tempo esgotado — a porta pode não estar aberta no roteador do host';
  }
  if (message.includes('ENOTFOUND') || message.includes('EAI_AGAIN')) {
    return 'endereço não encontrado — verifique o link de convite';
  }
  return message;
}
