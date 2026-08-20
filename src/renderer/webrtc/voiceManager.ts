import type { IncomingSignal } from '@shared/ipc';
import type { StreamOwner } from '@shared/protocol';
import type { AudioSettings } from '@shared/settings';
import { NoiseSuppressionChain, browserSuppression } from './noiseSuppression';
import { PeerLink } from './peerLink';
import { VOICE_SENDER } from './quality';
import { runtime } from './runtime';

/** Como uma pessoa deve ser ouvida por mim — decisão local, ninguém mais vê. */
export interface PeerAudio {
  volume: number;
  muted: boolean;
}

interface VoiceOptions {
  selfId: string;
  isHost: boolean;
  /** Id do host — o único peer com quem o convidado abre conexão. */
  hostId: string | null;
  onSpeaking(speakingIds: string[]): void;
  onError(detail: string): void;
  /** Volume/silenciamento que EU escolhi para cada pessoa. */
  resolvePeerAudio(ownerId: string): PeerAudio;
}

interface RemoteTrack {
  track: MediaStreamTrack;
  stream: MediaStream;
  from: string;
}

const POLL_MS = 150;

/**
 * Voz multi-participante em estrela.
 *
 * Cada convidado tem uma única conexão de voz: a do host. O host recebe o
 * áudio de todos e **repassa** a faixa de cada um para os demais (forwarding,
 * sem mixagem). Como o convidado recebe várias faixas por uma conexão só, o
 * host também envia o mapa `streamId -> dono`, que é o que permite mostrar
 * quem está falando e aplicar volume individual.
 *
 * O microfone passa por uma cadeia do Web Audio (origem → ganho → destino).
 * Isso dá duas coisas de graça: controle de volume de entrada, e troca de
 * microfone **sem renegociar** a conexão — só o nó de origem é trocado, a
 * faixa que sai continua a mesma.
 */
export class VoiceManager {
  private readonly links = new Map<string, PeerLink>();
  private readonly remoteTracks = new Map<string, RemoteTrack[]>();
  /** peerId -> (trackId -> sender), para desfazer o repasse quando alguém sai. */
  private readonly forwarded = new Map<string, Map<string, RTCRtpSender>>();
  private readonly streamOwner = new Map<string, string>();
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly monitors = new Map<string, Monitor>();
  private localSenders = new Map<string, RTCRtpSender>();

  // Cadeia de captura do microfone.
  private audioContext: AudioContext | null = null;
  private rawStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGain: GainNode | null = null;
  /** Segunda camada de supressão de ruído, entre o microfone e o ganho. */
  private suppression: NoiseSuppressionChain | null = null;
  private micDestination: MediaStreamAudioDestinationNode | null = null;
  private outgoingStream: MediaStream | null = null;

  private settings: AudioSettings;
  private timer: number | null = null;
  private speaking: string[] = [];
  private muted = false;
  private deafened = false;
  /** Portão do push-to-talk: em modo `open` fica sempre aberto. */
  private transmitting = true;
  /** Agrupa as atualizações do mapa de donos num envio só. */
  private streamMapTimer: number | null = null;
  private stopped = false;

  constructor(
    private readonly options: VoiceOptions,
    settings: AudioSettings,
  ) {
    this.settings = settings;
    this.transmitting = settings.voiceMode === 'open';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isDeafened(): boolean {
    return this.deafened;
  }

  /** Liga o microfone. Falhar aqui não derruba a sessão — segue sem voz. */
  async startMicrophone(): Promise<boolean> {
    if (this.outgoingStream) return true;
    try {
      const raw = await this.captureMicrophone();
      if (this.stopped) {
        raw.getTracks().forEach((track) => track.stop());
        return false;
      }

      const context = this.ensureContext();
      this.rawStream = raw;
      this.micSource = context.createMediaStreamSource(raw);
      this.micGain = context.createGain();
      this.micDestination = context.createMediaStreamDestination();

      // microfone -> supressão -> ganho -> faixa que sai.
      // Buscar e compilar o worklet leva um tempo, e sair da sala nesse meio
      // fecha o contexto por baixo. Sem reconferir, o que vinha depois
      // estourava e virava um "erro de microfone" que nunca existiu.
      this.suppression = await NoiseSuppressionChain.create(context);
      if (this.stopped) {
        this.suppression.dispose();
        this.suppression = null;
        raw.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.suppression.setLevel(this.settings.noiseSuppressionLevel);
      this.micSource.connect(this.suppression.input);
      this.suppression.output.connect(this.micGain);

      this.micGain.connect(this.micDestination);
      this.applyGain();

      this.outgoingStream = this.micDestination.stream;
      this.streamOwner.set(this.outgoingStream.id, this.options.selfId);

      const track = this.outgoingStream.getAudioTracks()[0];
      if (track) {
        // Avisa o codificador que é fala, não música: melhora inteligibilidade.
        track.contentHint = 'speech';
        this.applyTransmitState();
        for (const [peerId, link] of this.links) {
          const sender = link.addTrack(track, this.outgoingStream);
          if (!sender) continue;
          this.localSenders.set(peerId, sender);
          void link.tuneSender(sender, VOICE_SENDER);
        }
        // O medidor escuta depois do ganho: é o que o outro lado realmente ouve.
        this.monitor(track, () => this.options.selfId, this.micGain);
      }

      this.broadcastStreamMap();
      this.ensurePolling();
      return true;
    } catch (error) {
      // Sair da sala no meio da montagem fecha o contexto por baixo e faz o
      // resto estourar. É o fim esperado, não um problema de microfone para
      // mostrar na cara de quem já foi embora.
      if (this.stopped) return false;
      this.options.onError(describeMicError(error));
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Controles
  // -------------------------------------------------------------------------

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyTransmitState();
  }

  /** Ensurdecer: para de ouvir todo mundo — e, como no Discord, também cala você. */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    if (deafened) this.muted = true;
    this.applyTransmitState();
    this.refreshVolumes();
  }

  /** Portão do push-to-talk. Ignorado quando o modo é voz sempre aberta. */
  setTransmitting(active: boolean): void {
    if (this.settings.voiceMode === 'open') return;
    this.transmitting = active;
    this.applyTransmitState();
  }

  /** Reaplica preferências de áudio; troca de microfone não renegocia nada. */
  async applySettings(settings: AudioSettings): Promise<void> {
    const previous = this.settings;
    this.settings = settings;

    if (settings.voiceMode === 'open') this.transmitting = true;
    else if (previous.voiceMode === 'open') this.transmitting = false;

    this.applyGain();
    this.applyTransmitState();
    this.refreshVolumes();

    // Mudar de nível é só remontar nós: não mexe na faixa que sai, então a
    // pessoa pode experimentar os três no meio da conversa sem cortar a voz.
    if (previous.noiseSuppressionLevel !== settings.noiseSuppressionLevel) {
      this.suppression?.setLevel(settings.noiseSuppressionLevel);
    }

    const deviceChanged =
      previous.inputDeviceId !== settings.inputDeviceId ||
      previous.echoCancellation !== settings.echoCancellation ||
      browserSuppression(previous.noiseSuppressionLevel) !==
        browserSuppression(settings.noiseSuppressionLevel) ||
      previous.autoGainControl !== settings.autoGainControl;

    if (deviceChanged && this.rawStream) await this.switchInputDevice();
    if (previous.outputDeviceId !== settings.outputDeviceId) this.applyOutputDevice();
  }

  /** Reaplica volume/silenciamento individuais (chamado quando você muda algo). */
  refreshVolumes(): void {
    for (const [trackId, element] of this.audioElements) {
      const ownerId = this.ownerOfTrack(trackId);
      const peer = ownerId
        ? this.options.resolvePeerAudio(ownerId)
        : { volume: 100, muted: false };

      element.muted = this.deafened || peer.muted;
      // Dois ganhos em série (geral × individual), limitados ao teto do elemento.
      const volume = (this.settings.outputVolume / 100) * (peer.volume / 100);
      element.volume = Math.min(1, Math.max(0, volume));
    }
  }

  // -------------------------------------------------------------------------
  // Conexões
  // -------------------------------------------------------------------------

  /** Conexões vivas, para quem quer medir a rede sem mexer na mídia. */
  activeLinks(): PeerLink[] {
    return [...this.links.values()];
  }

  syncPeers(peerIds: string[]): void {
    if (this.stopped) return;
    const wanted = new Set(this.wantedPeers(peerIds));

    for (const peerId of wanted) {
      if (!this.links.has(peerId)) this.openLink(peerId);
    }
    for (const peerId of [...this.links.keys()]) {
      if (!wanted.has(peerId)) this.closeLink(peerId);
    }
  }

  handleSignal(signal: IncomingSignal): void {
    if (signal.channel !== 'voice' || this.stopped) return;

    if (signal.kind === 'streams') {
      for (const { streamId, ownerId } of signal.streams ?? []) {
        this.streamOwner.set(streamId, ownerId);
      }
      // Agora que sabemos de quem é cada faixa, o volume individual vale.
      this.refreshVolumes();
      return;
    }

    // Uma oferta pode chegar antes de `presence:update` trazer o participante.
    const link = this.links.get(signal.fromId) ?? this.openLink(signal.fromId);
    void link.handleSignal(signal);
  }

  stop(): void {
    this.stopped = true;
    if (this.streamMapTimer !== null) window.clearTimeout(this.streamMapTimer);
    this.streamMapTimer = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;

    for (const peerId of [...this.links.keys()]) this.closeLink(peerId);

    for (const element of this.audioElements.values()) {
      element.pause();
      element.srcObject = null;
      element.remove();
    }
    this.audioElements.clear();

    for (const monitor of this.monitors.values()) monitor.tap.disconnect();
    this.monitors.clear();

    this.micSource?.disconnect();
    this.suppression?.dispose();
    this.micGain?.disconnect();
    this.rawStream?.getTracks().forEach((track) => track.stop());
    this.rawStream = null;
    this.micSource = null;
    this.suppression = null;
    this.micGain = null;
    this.micDestination = null;
    this.outgoingStream = null;
    this.localSenders.clear();
    this.streamOwner.clear();

    void this.audioContext?.close();
    this.audioContext = null;
  }

  /**
   * Em estrela o convidado só conhece o host; em malha ele fala com a sala toda.
   * O host sempre enxerga todo mundo - é ele quem serve de campainha.
   */
  private wantedPeers(peerIds: string[]): string[] {
    if (this.options.isHost || runtime.mesh) {
      return peerIds.filter((id) => id !== this.options.selfId);
    }
    return this.options.hostId ? [this.options.hostId] : [];
  }

  /**
   * Só um lado pode ceder numa colisão de ofertas. Com o host a regra é fixa;
   * entre convidados o id decide, para os dois chegarem na mesma conclusão.
   */
  private politeWith(peerId: string): boolean {
    if (this.options.isHost) return false;
    if (peerId === this.options.hostId) return true;
    return this.options.selfId < peerId;
  }

  /** Repasse do host só existe na estrela: em malha a faixa já chega direto. */
  private get relaying(): boolean {
    return this.options.isHost && !runtime.mesh;
  }

  private openLink(peerId: string): PeerLink {
    // Host é o lado "impolite" da negociação: em colisão, a oferta dele vence.
    const link = new PeerLink(peerId, 'voice', this.politeWith(peerId), {
      onTrack: (track, stream) => this.handleRemoteTrack(peerId, track, stream),
      onTrackEnded: (track) => this.handleTrackEnded(peerId, track),
    });
    this.links.set(peerId, link);
    this.forwarded.set(peerId, new Map());

    const localTrack = this.outgoingStream?.getAudioTracks()[0];
    if (localTrack && this.outgoingStream) {
      const sender = link.addTrack(localTrack, this.outgoingStream);
      if (sender) {
        this.localSenders.set(peerId, sender);
        void link.tuneSender(sender, VOICE_SENDER);
      }
    }

    // Host abre a conexão já repassando o áudio de quem entrou antes.
    if (this.relaying) {
      for (const [originId, tracks] of this.remoteTracks) {
        if (originId === peerId) continue;
        for (const { track, stream } of tracks) this.forward(peerId, link, track, stream);
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

    for (const { track, stream } of this.remoteTracks.get(peerId) ?? []) {
      this.dropForwarded(track);
      this.stopPlayback(track);
      this.streamOwner.delete(stream.id);
    }
    this.remoteTracks.delete(peerId);

    if (this.options.isHost) this.broadcastStreamMap();
  }

  private handleRemoteTrack(peerId: string, track: MediaStreamTrack, stream: MediaStream): void {
    if (track.kind !== 'audio') return;

    const list = this.remoteTracks.get(peerId) ?? [];
    list.push({ track, stream, from: peerId });
    this.remoteTracks.set(peerId, list);

    if (this.options.isHost || runtime.mesh) {
      // Numa conexão direta a faixa é de quem está do outro lado.
      this.streamOwner.set(stream.id, peerId);
    }
    if (this.relaying) {
      for (const [otherId, link] of this.links) {
        if (otherId === peerId) continue;
        this.forward(otherId, link, track, stream);
      }
      this.broadcastStreamMap();
    }

    this.play(track, stream);
    this.monitor(track, () => this.ownerOfStream(stream, peerId));
    this.ensurePolling();
  }

  private handleTrackEnded(peerId: string, track: MediaStreamTrack): void {
    const list = this.remoteTracks.get(peerId);
    if (list) {
      this.remoteTracks.set(
        peerId,
        list.filter((entry) => entry.track.id !== track.id),
      );
    }
    this.dropForwarded(track);
    this.stopPlayback(track);
    if (this.options.isHost) this.broadcastStreamMap();
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
    void link.tuneSender(sender, VOICE_SENDER);
  }

  private dropForwarded(track: MediaStreamTrack): void {
    for (const [peerId, senders] of this.forwarded) {
      const sender = senders.get(track.id);
      if (!sender) continue;
      this.links.get(peerId)?.removeSender(sender);
      senders.delete(track.id);
    }
  }

  /**
   * Só o host chama: conta a cada convidado de quem é cada stream repassada.
   *
   * Agrupado de propósito. Quando alguém entra ou começa a compartilhar, o
   * mapa muda várias vezes em poucos milissegundos, e mandar a cada mudança
   * custa (participantes × mudanças) mensagens — com 6 pessoas isso vira uma
   * enxurrada de IPC bem no pior momento, que é justamente quando a
   * renegociação do WebRTC está acontecendo.
   */
  private broadcastStreamMap(): void {
    // Em malha ninguém precisa do mapa: cada faixa chega pela conexão do dono.
    if (!this.options.isHost || runtime.mesh || this.stopped) return;
    if (this.streamMapTimer !== null) return;

    this.streamMapTimer = window.setTimeout(() => {
      this.streamMapTimer = null;
      if (this.stopped) return;

      const streams: StreamOwner[] = [...this.streamOwner].map(([streamId, ownerId]) => ({
        streamId,
        ownerId,
      }));
      for (const peerId of this.links.keys()) {
        void window.only.sendSignal({ targetId: peerId, channel: 'voice', streams });
      }
    }, 120);
  }

  // -------------------------------------------------------------------------
  // Captura
  // -------------------------------------------------------------------------

  private captureMicrophone(): Promise<MediaStream> {
    const { inputDeviceId, echoCancellation, autoGainControl } = this.settings;
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
        echoCancellation,
        noiseSuppression: browserSuppression(this.settings.noiseSuppressionLevel),
        autoGainControl,
        sampleRate: 48_000,
        channelCount: 2,
      },
      video: false,
    });
  }

  /**
   * Troca o microfone sem renegociar: o nó de destino (e portanto a faixa que
   * sai) continua o mesmo, só a origem é substituída.
   */
  private async switchInputDevice(): Promise<void> {
    if (!this.audioContext || !this.micGain) return;
    try {
      const raw = await this.captureMicrophone();
      this.micSource?.disconnect();
      this.rawStream?.getTracks().forEach((track) => track.stop());

      this.rawStream = raw;
      this.micSource = this.audioContext.createMediaStreamSource(raw);
      // Volta para a entrada da cadeia, não direto no ganho: senão trocar de
      // microfone desligava a supressão sem ninguém notar.
      this.micSource.connect(this.suppression?.input ?? this.micGain);
    } catch (error) {
      this.options.onError(describeMicError(error));
    }
  }

  private applyGain(): void {
    if (!this.micGain) return;
    this.micGain.gain.value = Math.max(0, this.settings.inputVolume / 100);
  }

  /** Mudo, ensurdecido ou push-to-talk solto: tudo fecha a mesma torneira. */
  private applyTransmitState(): void {
    const track = this.outgoingStream?.getAudioTracks()[0];
    if (track) track.enabled = !this.muted && this.transmitting;
  }

  private applyOutputDevice(): void {
    const deviceId = this.settings.outputDeviceId;
    for (const element of this.audioElements.values()) {
      void setSinkId(element, deviceId);
    }
  }

  private ensureContext(): AudioContext {
    this.audioContext ??= new AudioContext({ sampleRate: 48_000 });
    return this.audioContext;
  }

  private ownerOfStream(stream: MediaStream, peerId: string): string | null {
    // Em malha (e no host) toda faixa chega pela conexão do próprio dono.
    if (this.options.isHost || runtime.mesh) return peerId;
    return this.streamOwner.get(stream.id) ?? null;
  }

  private ownerOfTrack(trackId: string): string | null {
    for (const [peerId, tracks] of this.remoteTracks) {
      for (const entry of tracks) {
        if (entry.track.id === trackId) return this.ownerOfStream(entry.stream, peerId);
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Reprodução e detecção de fala
  // -------------------------------------------------------------------------

  private play(track: MediaStreamTrack, _stream: MediaStream): void {
    const element = new Audio();
    element.autoplay = true;
    element.srcObject = new MediaStream([track]);
    element.style.display = 'none';
    // Precisa estar no documento para o Chromium manter a reprodução.
    document.body.appendChild(element);
    void element.play().catch((error) => console.warn('[voz] autoplay bloqueado', error));

    this.audioElements.set(track.id, element);
    void setSinkId(element, this.settings.outputDeviceId);
    this.refreshVolumes();
  }

  private stopPlayback(track: MediaStreamTrack): void {
    const element = this.audioElements.get(track.id);
    if (element) {
      element.pause();
      element.srcObject = null;
      element.remove();
      this.audioElements.delete(track.id);
    }
    const monitor = this.monitors.get(track.id);
    if (monitor) {
      monitor.tap.disconnect();
      this.monitors.delete(track.id);
    }
  }

  /**
   * Medidor de fala. Para o microfone local o tap vem depois do ganho; para
   * faixas remotas criamos uma origem a partir da própria faixa.
   */
  private monitor(
    track: MediaStreamTrack,
    ownerOf: () => string | null,
    upstream?: AudioNode,
  ): void {
    try {
      const context = this.ensureContext();
      const tap = upstream ?? context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      tap.connect(analyser);
      this.monitors.set(track.id, {
        analyser,
        tap,
        ownerOf,
        isLocal: upstream !== undefined,
        data: new Uint8Array(analyser.fftSize),
      });
    } catch (error) {
      console.warn('[voz] sem indicador de fala para esta faixa', error);
    }
  }

  private ensurePolling(): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = window.setInterval(() => this.pollSpeaking(), POLL_MS);
  }

  private pollSpeaking(): void {
    const active = new Set<string>();
    // 0–100 na interface vira 0–0.2 de RMS, faixa onde fala normal se separa
    // bem do ruído de fundo.
    const threshold = Math.max(0.005, (this.settings.speakingSensitivity / 100) * 0.2);

    for (const monitor of this.monitors.values()) {
      if (monitor.isLocal && (this.muted || !this.transmitting)) continue;
      const ownerId = monitor.ownerOf();
      if (!ownerId) continue;
      if (!monitor.isLocal && this.deafened) continue;

      monitor.analyser.getByteTimeDomainData(monitor.data);
      if (rms(monitor.data) > threshold) active.add(ownerId);
    }

    const next = [...active].sort();
    if (next.length !== this.speaking.length || next.some((id, i) => id !== this.speaking[i])) {
      this.speaking = next;
      this.options.onSpeaking(next);
    }
  }
}

interface Monitor {
  analyser: AnalyserNode;
  tap: AudioNode;
  ownerOf: () => string | null;
  isLocal: boolean;
  /** Buffer reaproveitado; `getByteTimeDomainData` não aceita `SharedArrayBuffer`. */
  data: Uint8Array<ArrayBuffer>;
}

/** Volume médio da janela, em 0..1 (128 é o silêncio no formato de 8 bits). */
function rms(data: Uint8Array): number {
  let sum = 0;
  for (const sample of data) {
    const value = (sample - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / data.length);
}

/** `setSinkId` não existe em todo navegador; no Chromium do Electron existe. */
async function setSinkId(element: HTMLAudioElement, deviceId: string): Promise<void> {
  const target = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof target.setSinkId !== 'function') return;
  try {
    await target.setSinkId(deviceId);
  } catch (error) {
    console.warn('[voz] não deu para usar a saída escolhida', error);
  }
}

function describeMicError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') {
    return 'permissão de microfone negada — libere o acesso nas configurações do Windows';
  }
  if (name === 'NotFoundError') {
    return 'nenhum microfone encontrado — você continua ouvindo os outros';
  }
  if (name === 'OverconstrainedError') {
    return 'o microfone escolhido sumiu — selecione outro nas configurações';
  }
  return error instanceof Error ? error.message : 'não foi possível abrir o microfone';
}
