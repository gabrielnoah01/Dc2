import type { IncomingSignal } from '@shared/ipc';
import type { StreamOwner } from '@shared/protocol';
import { PeerLink } from './peerLink';
import {
  DEFAULT_PRESET,
  SHARE_PRESETS,
  forwardQuality,
  type SharePresetId,
} from './quality';
import { runtime } from './runtime';

/** Uma tela recebida, já resolvida para o dono. */
export interface RemoteScreen {
  ownerId: string;
  stream: MediaStream;
}

interface ScreenShareOptions {
  selfId: string;
  isHost: boolean;
  hostId: string | null;
  /** Todas as telas que estamos recebendo agora. */
  onRemoteScreens(screens: RemoteScreen[]): void;
  /** Prévia da própria tela compartilhada. */
  onLocalStream(stream: MediaStream | null): void;
  /** O usuário parou pelo botão do Chromium, não pela UI do app. */
  onLocalStopped(): void;
  onError(detail: string): void;
}

interface ReceivedTrack {
  track: MediaStreamTrack;
  stream: MediaStream;
  /** De qual conexão veio — no host, é o próprio dono. */
  from: string;
}

/**
 * Compartilhamento de tela — mesma topologia da voz, em conexões separadas
 * (canal `screen`) para que ligar/desligar a tela nunca derrube o áudio.
 *
 * Várias pessoas podem compartilhar ao mesmo tempo. Como o convidado recebe
 * todas as telas por uma conexão só (a do host), o host envia junto o mapa
 * `streamId -> dono`, que é o que permite rotular cada vídeo.
 */
export class ScreenShareManager {
  private readonly links = new Map<string, PeerLink>();
  /** peerId -> (trackId -> sender) do que estamos repassando para ele. */
  private readonly forwarded = new Map<string, Map<string, RTCRtpSender>>();
  private readonly localSenders = new Map<string, RTCRtpSender>();
  private readonly received: ReceivedTrack[] = [];
  private readonly streamOwner = new Map<string, string>();

  private localStream: MediaStream | null = null;
  /** Modo escolhido para a transmissão local (fluidez ou nitidez). */
  private preset = SHARE_PRESETS[DEFAULT_PRESET];

  /** Preset escolhido, com o teto de banda das configurações aplicado por cima. */
  private get senderQuality() {
    return {
      ...this.preset.sender,
      maxBitrate: Math.min(this.preset.sender.maxBitrate, runtime.screenBitrate),
    };
  }
  private stopped = false;

  constructor(private readonly options: ScreenShareOptions) {}

  get isSharing(): boolean {
    return this.localStream !== null;
  }

  syncPeers(peerIds: string[]): void {
    if (this.stopped) return;
    const wanted = new Set(
      this.options.isHost
        ? peerIds.filter((id) => id !== this.options.selfId)
        : this.options.hostId
          ? [this.options.hostId]
          : [],
    );

    for (const peerId of wanted) {
      if (!this.links.has(peerId)) this.openLink(peerId);
    }
    for (const peerId of [...this.links.keys()]) {
      if (!wanted.has(peerId)) this.closeLink(peerId);
    }
  }

  handleSignal(signal: IncomingSignal): void {
    if (signal.channel !== 'screen' || this.stopped) return;

    if (signal.kind === 'streams') {
      for (const { streamId, ownerId } of signal.streams ?? []) {
        this.streamOwner.set(streamId, ownerId);
      }
      this.emitScreens();
      return;
    }

    const link = this.links.get(signal.fromId) ?? this.openLink(signal.fromId);
    void link.handleSignal(signal);
  }

  /** Começa a compartilhar a janela/tela escolhida na UI. */
  async start(sourceId: string, presetId: SharePresetId = DEFAULT_PRESET): Promise<boolean> {
    if (this.localStream) this.stopSharing();
    this.preset = SHARE_PRESETS[presetId] ?? SHARE_PRESETS[DEFAULT_PRESET];
    try {
      // O main arma qual fonte o `getDisplayMedia` deve devolver (a que o
      // usuário escolheu no picker) e responde sem abrir o seletor do sistema.
      await window.only.selectScreenSource(sourceId);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          ...this.preset.constraints,
          // `cursor` não está nos tipos padrão, mas o Chromium respeita.
          cursor: runtime.showCursor ? 'always' : 'never',
        } as MediaTrackConstraints,
      });
      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      this.localStream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('a fonte escolhida não devolveu vídeo');

      // Diz ao codificador o que sacrificar quando a banda apertar.
      track.contentHint = this.preset.contentHint;

      track.addEventListener('ended', () => {
        // Usuário clicou em "parar compartilhamento" fora do app.
        this.stopSharing();
        this.options.onLocalStopped();
      });

      this.streamOwner.set(stream.id, this.options.selfId);

      for (const [peerId, link] of this.links) {
        const sender = link.addTrack(track, stream);
        if (!sender) continue;
        this.localSenders.set(peerId, sender);
        link.preferVideoCodecs();
        void link.tuneSender(sender, this.senderQuality);
      }

      this.broadcastStreamMap();
      this.options.onLocalStream(stream);
      return true;
    } catch (error) {
      this.options.onError(
        error instanceof Error ? error.message : 'não foi possível capturar a tela',
      );
      return false;
    }
  }

  /** Para de enviar a própria tela (mantém as conexões vivas). */
  stopSharing(): void {
    if (!this.localStream) return;

    for (const [peerId, sender] of this.localSenders) {
      this.links.get(peerId)?.removeSender(sender);
    }
    this.localSenders.clear();

    this.streamOwner.delete(this.localStream.id);
    this.localStream.getTracks().forEach((track) => track.stop());
    this.localStream = null;

    this.broadcastStreamMap();
    this.options.onLocalStream(null);
  }

  dispose(): void {
    this.stopped = true;
    this.stopSharing();
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.forwarded.clear();
    this.received.length = 0;
    this.streamOwner.clear();
    this.options.onRemoteScreens([]);
  }

  // -------------------------------------------------------------------------

  private openLink(peerId: string): PeerLink {
    // Host é o lado "impolite" da negociação: em colisão, a oferta dele vence.
    const link = new PeerLink(peerId, 'screen', !this.options.isHost, {
      onTrack: (track, stream) => this.handleRemoteTrack(peerId, track, stream),
      onTrackEnded: (track) => this.handleTrackEnded(peerId, track),
    });
    this.links.set(peerId, link);
    this.forwarded.set(peerId, new Map());

    const localTrack = this.localStream?.getVideoTracks()[0];
    if (localTrack && this.localStream) {
      const sender = link.addTrack(localTrack, this.localStream);
      if (sender) {
        this.localSenders.set(peerId, sender);
        link.preferVideoCodecs();
        void link.tuneSender(sender, this.senderQuality);
      }
    }

    // Quem entra no meio já recebe as telas que estão rolando.
    if (this.options.isHost) {
      for (const entry of this.received) {
        if (entry.from === peerId) continue;
        this.forward(peerId, link, entry.track, entry.stream);
      }
      this.broadcastStreamMap();
    }

    return link;
  }

  private closeLink(peerId: string): void {
    this.links.get(peerId)?.close();
    this.links.delete(peerId);
    this.localSenders.delete(peerId);
    this.forwarded.delete(peerId);

    // Tira as telas de quem saiu de todas as outras conexões.
    for (const entry of this.received.filter((item) => item.from === peerId)) {
      this.dropForwarded(entry.track);
      this.streamOwner.delete(entry.stream.id);
    }
    this.removeReceived((entry) => entry.from === peerId);

    if (this.options.isHost) this.broadcastStreamMap();
    this.emitScreens();
  }

  private handleRemoteTrack(peerId: string, track: MediaStreamTrack, stream: MediaStream): void {
    if (track.kind !== 'video') return;

    this.received.push({ track, stream, from: peerId });

    if (this.options.isHost) {
      // Numa conexão direta a tela é de quem está do outro lado.
      this.streamOwner.set(stream.id, peerId);
      for (const [otherId, link] of this.links) {
        if (otherId === peerId) continue;
        this.forward(otherId, link, track, stream);
      }
      this.broadcastStreamMap();
    }

    this.emitScreens();
  }

  private handleTrackEnded(peerId: string, track: MediaStreamTrack): void {
    const entry = this.received.find(
      (item) => item.from === peerId && item.track.id === track.id,
    );
    if (!entry) return;

    this.dropForwarded(track);
    this.streamOwner.delete(entry.stream.id);
    this.removeReceived((item) => item.track.id === track.id);

    if (this.options.isHost) this.broadcastStreamMap();
    this.emitScreens();
  }

  private forward(
    peerId: string,
    link: PeerLink,
    track: MediaStreamTrack,
    stream: MediaStream,
  ): void {
    const senders = this.forwarded.get(peerId);
    if (!senders || senders.has(track.id)) return;
    const sender = link.addTrack(track, stream);
    if (!sender) return;
    senders.set(track.id, sender);
    link.preferVideoCodecs();
    // O host não sabe em que modo o dono capturou, então repassa com o teto
    // do modo mais exigente, reduzido para não estourar o upload dele.
    void link.tuneSender(sender, forwardQuality(this.senderQuality));
  }

  private dropForwarded(track: MediaStreamTrack): void {
    for (const [peerId, senders] of this.forwarded) {
      const sender = senders.get(track.id);
      if (!sender) continue;
      this.links.get(peerId)?.removeSender(sender);
      senders.delete(track.id);
    }
  }

  private removeReceived(predicate: (entry: ReceivedTrack) => boolean): void {
    for (let index = this.received.length - 1; index >= 0; index -= 1) {
      if (predicate(this.received[index])) this.received.splice(index, 1);
    }
  }

  /** Só o host chama: conta a cada convidado de quem é cada tela repassada. */
  private broadcastStreamMap(): void {
    if (!this.options.isHost) return;
    const streams: StreamOwner[] = [...this.streamOwner].map(([streamId, ownerId]) => ({
      streamId,
      ownerId,
    }));
    for (const peerId of this.links.keys()) {
      void window.only.sendSignal({ targetId: peerId, channel: 'screen', streams });
    }
  }

  private emitScreens(): void {
    const screens: RemoteScreen[] = [];
    for (const entry of this.received) {
      // No host o dono é o peer da conexão; no convidado vem do mapa do host.
      const ownerId = this.options.isHost
        ? entry.from
        : this.streamOwner.get(entry.stream.id);
      // Sem dono conhecido ainda, esperamos o mapa chegar em vez de rotular errado.
      if (ownerId) screens.push({ ownerId, stream: entry.stream });
    }
    this.options.onRemoteScreens(screens);
  }
}
