import type { IncomingSignal } from '@shared/ipc';
import type { StreamOwner } from '@shared/protocol';
import { PeerLink } from './peerLink';
import {
  DEFAULT_PRESET,
  SHARE_PRESETS,
  forwardQuality,
  throttledQuality,
  type SharePresetId,
  type WindowActivity,
} from './quality';
import { onRuntimeChange, runtime } from './runtime';

/**
 * Quanto esperar antes de tratar uma faixa emudecida como acabada. Curto
 * demais e um engasgo de rede tira a tela do ar; longo demais e a tela de quem
 * saiu fica congelada na grade.
 */
const MUTE_GRACE_MS = 5_000;

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

  /** Faixas que emudeceram e estão no prazo antes de contar como acabadas. */
  private readonly muteTimers = new Map<string, number>();

  private localStream: MediaStream | null = null;
  /** Modo escolhido para a transmissão local (fluidez ou nitidez). */
  private preset = SHARE_PRESETS[DEFAULT_PRESET];
  /** Agrupa as atualizações do mapa de donos num envio só. */
  private streamMapTimer: number | null = null;
  /** Estado da janela, para aliviar o encoder quando ninguém está olhando. */
  private activity: WindowActivity = 'active';

  /**
   * Preset escolhido, com o teto das configurações e uma redução conforme o
   * tamanho da sala.
   *
   * O host manda a mesma tela para cada destinatário separadamente, então o
   * upload dele é (bitrate × pessoas). Com 6 pessoas a 6 Mbps seriam 36 Mbps,
   * acima do que a maioria das conexões domésticas sustenta — e o resultado
   * não é "um pouco pior para todos", é travamento para todos. Reduzir pela
   * raiz do número de destinatários degrada de forma suave em vez de estourar.
   */
  private get senderQuality() {
    const recipients = Math.max(1, this.links.size);
    const scale = recipients <= 1 ? 1 : Math.max(0.35, 1 / Math.sqrt(recipients));
    const ceiling = Math.min(this.preset.sender.maxBitrate, runtime.screenBitrate);

    const quality = {
      ...this.preset.sender,
      maxBitrate: Math.round(ceiling * scale),
    };

    // Só entra no caminho quando a pessoa pediu: por padrão a janela em segundo
    // plano não muda nada do que os outros recebem.
    return runtime.throttleShareWhenHidden
      ? throttledQuality(quality, this.activity)
      : quality;
  }

  /**
   * A janela mudou de estado. Reaplicar a qualidade é barato (é só
   * `setParameters`) e não renegocia nada, então pode acompanhar de perto.
   */
  setActivity(activity: WindowActivity): void {
    if (this.activity === activity) return;
    this.activity = activity;
    this.retuneSenders();
  }

  /**
   * As preferências de tela mudaram: o teto de banda, o modo, ou a própria
   * redução de segundo plano. Sem isto, desligar a redução com a janela
   * minimizada deixava o envio preso em um quarto do bitrate até que alguém
   * entrasse ou saísse da sala.
   */
  private applyPreferences(): void {
    if (this.stopped) return;
    this.retuneSenders();
  }

  /** Reaplica a qualidade quando a sala muda de tamanho. */
  private retuneSenders(): void {
    const quality = this.senderQuality;
    for (const [peerId, sender] of this.localSenders) {
      void this.links.get(peerId)?.tuneSender(sender, quality);
    }
    for (const [peerId, senders] of this.forwarded) {
      const link = this.links.get(peerId);
      if (!link) continue;
      for (const sender of senders.values()) {
        void link.tuneSender(sender, forwardQuality(quality));
      }
    }
  }
  private stopped = false;

  /** Solto quando o gerente morre; sem isto o ouvinte vazaria por sessão. */
  private readonly offRuntimeChange = onRuntimeChange(() => this.applyPreferences());

  constructor(private readonly options: ScreenShareOptions) {}

  get isSharing(): boolean {
    return this.localStream !== null;
  }

  /** Conexões vivas, para quem quer medir a rede sem mexer na mídia. */
  activeLinks(): PeerLink[] {
    return [...this.links.values()];
  }

  syncPeers(peerIds: string[]): void {
    if (this.stopped) return;
    const previousSize = this.links.size;
    const wanted = new Set(this.wantedPeers(peerIds));

    // Quem saiu da sala não pode continuar dono de tela nenhuma. Em estrela o
    // mapa vem do host, e um `screenshare:stopped` perdido no meio de uma saída
    // deixava o dono registrado para sempre — era a tela que ficava lá parada.
    this.pruneOwners(peerIds);

    for (const peerId of wanted) {
      if (!this.links.has(peerId)) this.openLink(peerId);
    }
    for (const peerId of [...this.links.keys()]) {
      if (!wanted.has(peerId)) this.closeLink(peerId);
    }

    // A sala mudou de tamanho: o quanto cada tela pode gastar muda junto.
    if (this.links.size !== previousSize) this.retuneSenders();
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
    this.offRuntimeChange();
    if (this.streamMapTimer !== null) window.clearTimeout(this.streamMapTimer);
    this.streamMapTimer = null;
    for (const timer of this.muteTimers.values()) window.clearTimeout(timer);
    this.muteTimers.clear();
    this.stopSharing();
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.forwarded.clear();
    this.received.length = 0;
    this.streamOwner.clear();
    this.options.onRemoteScreens([]);
  }

  // -------------------------------------------------------------------------

  /** Em malha o convidado abre tela com a sala toda; em estrela só com o host. */
  private wantedPeers(peerIds: string[]): string[] {
    if (this.options.isHost || runtime.mesh) {
      return peerIds.filter((id) => id !== this.options.selfId);
    }
    return this.options.hostId ? [this.options.hostId] : [];
  }

  /** Entre convidados o id desempata a colisão de ofertas; com o host, o papel. */
  private politeWith(peerId: string): boolean {
    if (this.options.isHost) return false;
    if (peerId === this.options.hostId) return true;
    return this.options.selfId < peerId;
  }

  /** Repasse do host só existe na estrela: em malha a tela já chega direto. */
  private get relaying(): boolean {
    return this.options.isHost && !runtime.mesh;
  }

  private openLink(peerId: string): PeerLink {
    // Host é o lado "impolite" da negociação: em colisão, a oferta dele vence.
    const link = new PeerLink(peerId, 'screen', this.politeWith(peerId), {
      onTrack: (track, stream) => this.handleRemoteTrack(peerId, track, stream),
      onTrackEnded: (track) => this.handleTrackEnded(peerId, track),
      onTrackMuted: (track) => this.handleTrackMuted(peerId, track),
      onTrackUnmuted: (track, stream) => this.handleTrackUnmuted(peerId, track, stream),
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
    if (this.relaying) {
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

    if (this.options.isHost || runtime.mesh) {
      // Numa conexão direta a tela é de quem está do outro lado.
      this.streamOwner.set(stream.id, peerId);
    }
    if (this.relaying) {
      for (const [otherId, link] of this.links) {
        if (otherId === peerId) continue;
        this.forward(otherId, link, track, stream);
      }
      this.broadcastStreamMap();
    }

    this.emitScreens();
  }

  private handleTrackEnded(peerId: string, track: MediaStreamTrack): void {
    this.cancelMuteTimer(track);

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

  /**
   * Faixa emudecida: pode ser um engasgo de rede (volta sozinha em segundos) ou
   * a tela tendo acabado sem `ended`. Esperar o prazo distingue os dois casos
   * sem tirar da tela quem só teve uma oscilação.
   */
  private handleTrackMuted(peerId: string, track: MediaStreamTrack): void {
    if (this.stopped || this.muteTimers.has(track.id)) return;

    const timer = window.setTimeout(() => {
      this.muteTimers.delete(track.id);
      // Voltou a receber no meio do caminho: não era o fim.
      if (this.stopped || !track.muted) return;
      this.handleTrackEnded(peerId, track);
    }, MUTE_GRACE_MS);

    this.muteTimers.set(track.id, timer);
  }

  /**
   * A faixa voltou a receber. Se o prazo já tinha vencido, ela foi tratada
   * como acabada e saiu de tudo — do mapa de donos ao repasse. Cancelar o
   * timer não desfaz nada disso, então ela precisa entrar de novo pela porta
   * da frente; senão um engasgo de mais de cinco segundos derruba a tela para
   * sempre — e, no host, para todo mundo junto.
   */
  private handleTrackUnmuted(
    peerId: string,
    track: MediaStreamTrack,
    stream: MediaStream,
  ): void {
    if (this.stopped) return;
    this.cancelMuteTimer(track);

    const known = this.received.some((item) => item.track.id === track.id);
    if (known || track.readyState === 'ended') return;

    this.handleRemoteTrack(peerId, track, stream);
  }

  private cancelMuteTimer(track: MediaStreamTrack): void {
    const timer = this.muteTimers.get(track.id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.muteTimers.delete(track.id);
  }

  /** Tira do mapa de donos quem não está mais na sala. */
  private pruneOwners(peerIds: string[]): void {
    const present = new Set([...peerIds, this.options.selfId]);
    let changed = false;
    for (const [streamId, ownerId] of this.streamOwner) {
      if (present.has(ownerId)) continue;
      this.streamOwner.delete(streamId);
      changed = true;
    }
    if (changed) this.emitScreens();
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

  /**
   * Só o host chama: conta a cada convidado de quem é cada tela repassada.
   *
   * Agrupado de propósito. Quando alguém entra ou começa a compartilhar, o
   * mapa muda várias vezes em poucos milissegundos, e mandar a cada mudança
   * custa (participantes × mudanças) mensagens — bem no momento em que a
   * renegociação do WebRTC já está consumindo tudo.
   */
  private broadcastStreamMap(): void {
    if (!this.options.isHost || this.stopped) return;
    if (this.streamMapTimer !== null) return;

    this.streamMapTimer = window.setTimeout(() => {
      this.streamMapTimer = null;
      if (this.stopped) return;

      const streams: StreamOwner[] = [...this.streamOwner].map(([streamId, ownerId]) => ({
        streamId,
        ownerId,
      }));
      for (const peerId of this.links.keys()) {
        void window.only.sendSignal({ targetId: peerId, channel: 'screen', streams });
      }
    }, 120);
  }

  private emitScreens(): void {
    const screens: RemoteScreen[] = [];
    for (const entry of this.received) {
      // No host o dono é o peer da conexão; no convidado vem do mapa do host.
      const ownerId = this.options.isHost || runtime.mesh
        ? entry.from
        : this.streamOwner.get(entry.stream.id);
      // Sem dono conhecido ainda, esperamos o mapa chegar em vez de rotular errado.
      if (ownerId) screens.push({ ownerId, stream: entry.stream });
    }
    this.options.onRemoteScreens(screens);
  }
}
