/**
 * Contrato único das mensagens trocadas pelo WebSocket entre host e convidados.
 *
 * A topologia é uma estrela: convidados só falam com o host, e o host repassa
 * (relay) o que for destinado a outro participante. Por isso as mensagens de
 * sinalização carregam `targetId` na ida e `fromId` na volta — nenhum convidado
 * precisa conhecer o endereço de outro.
 */

export interface Participant {
  id: string;
  username: string;
  isHost: boolean;
}

/**
 * Imagem anexada a uma mensagem. O `dataUrl` só viaja quando o destinatário
 * precisa exibir agora — no disco do host fica o arquivo, não a string base64.
 */
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes do arquivo original (não do base64). */
  size: number;
  width: number;
  height: number;
  /** Ausente quando a imagem não coube no orçamento do histórico. */
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  fromId: string;
  username: string;
  text: string;
  ts: number;
  attachment?: Attachment;
}

/** Descrição de sessão WebRTC. Tipado de forma estrutural para que o processo
 *  main (Node, sem lib DOM de WebRTC) possa apenas repassar sem depender dos
 *  tipos do Chromium. */
export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Para que serve a conexão WebRTC — voz e tela usam conexões separadas para
 *  que ligar/desligar a tela não perturbe o áudio já estabelecido. */
export type RtcChannel = 'voice' | 'screen';

/** Dono de cada `MediaStream` que o host repassa. Como o áudio de todos chega
 *  ao convidado por uma única conexão (a do host), sem este mapa não há como
 *  saber de quem é cada faixa — é o que permite o indicador de "falando". */
export interface StreamOwner {
  streamId: string;
  ownerId: string;
}

// ---------------------------------------------------------------------------
// Convidado -> Host
// ---------------------------------------------------------------------------

/**
 * Combinados da sala, anunciados na entrada. O convidado precisa saber antes
 * de abrir a primeira conexão: em malha ele fala com todo mundo, em estrela só
 * com o host, e cifrar sem o outro lado saber abrir é o mesmo que emudecer.
 */
export interface RoomFeatures {
  /** Cada convidado conecta direto com os outros; o host para de repassar áudio. */
  mesh: boolean;
  /** O host aprova cada entrada na mão. */
  approval: boolean;
}

export type ClientMessage =
  | { type: 'join'; token: string; username: string; protocol?: number }
  | {
      type: 'chat:send';
      text: string;
      /** Imagem já comprimida pelo remetente. */
      attachment?: { name: string; mimeType: string; dataUrl: string; width: number; height: number };
    }
  /** Pede a imagem cheia de uma mensagem antiga do histórico. */
  | { type: 'chat:attachment'; messageId: string }
  | { type: 'rtc:offer'; targetId: string; channel: RtcChannel; sdp: SessionDescription }
  | { type: 'rtc:answer'; targetId: string; channel: RtcChannel; sdp: SessionDescription }
  | { type: 'rtc:ice'; targetId: string; channel: RtcChannel; candidate: IceCandidate }
  | { type: 'screenshare:start' }
  | { type: 'screenshare:stop' }
  | { type: 'leave' };

// ---------------------------------------------------------------------------
// Host -> Convidado(s)
// ---------------------------------------------------------------------------

export type ServerMessage =
  | {
      type: 'join:accepted';
      selfId: string;
      participants: Participant[];
      screenSharerIds: string[];
      /** Ausente = host de versão antiga, que não sabe negociar versão. */
      protocol?: number;
      /** O que esta sala faz. Ausente = host antigo: estrela, sem cifra. */
      features?: RoomFeatures;
    }
  | { type: 'join:rejected'; reason: string }
  /**
   * O host exige aprovação manual e ainda não decidiu. Não é erro nem entrada:
   * o convidado fica esperando de propósito, com a tela dizendo isso.
   */
  | { type: 'join:pending'; reason?: string }
  | { type: 'presence:update'; participants: Participant[] }
  | { type: 'chat:broadcast'; message: ChatMessage }
  /** Histórico enviado logo após a entrada, do mais antigo para o mais novo. */
  | { type: 'chat:history'; messages: ChatMessage[] }
  /** Resposta ao pedido de uma imagem antiga. */
  | { type: 'chat:attachment'; messageId: string; dataUrl: string | null }
  | { type: 'rtc:offer'; fromId: string; channel: RtcChannel; sdp: SessionDescription }
  | { type: 'rtc:answer'; fromId: string; channel: RtcChannel; sdp: SessionDescription }
  | { type: 'rtc:ice'; fromId: string; channel: RtcChannel; candidate: IceCandidate }
  | { type: 'rtc:streams'; fromId: string; channel: RtcChannel; streams: StreamOwner[] }
  | { type: 'screenshare:started'; fromId: string }
  | { type: 'screenshare:stopped'; fromId: string };

export type AnyMessage = ClientMessage | ServerMessage;

/** Parse defensivo: uma mensagem malformada nunca deve derrubar o servidor. */
export function parseMessage<T extends AnyMessage>(raw: string): T | null {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && typeof value.type === 'string') {
      return value as T;
    }
  } catch {
    // ignora — tratado como mensagem inválida pelo chamador
  }
  return null;
}

export function serialize(message: AnyMessage): string {
  return JSON.stringify(message);
}
