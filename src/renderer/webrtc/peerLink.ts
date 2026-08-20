import { runtime } from './runtime';
import type { IncomingSignal } from '@shared/ipc';
import type { RtcChannel } from '@shared/protocol';
import type { SenderQuality } from './quality';
import { tuneOpus } from './sdp';

export interface PeerLinkEvents {
  /** Faixa recebida do outro lado. `stream` identifica a origem da mídia. */
  onTrack(track: MediaStreamTrack, stream: MediaStream): void;
  /** A faixa acabou (o outro lado parou de compartilhar / saiu). */
  onTrackEnded(track: MediaStreamTrack, stream: MediaStream): void;
  /**
   * A faixa parou de receber mídia sem ter acabado formalmente.
   *
   * É o que acontece quando o host deixa de repassar a tela de alguém: o
   * `removeTrack` do outro lado só desliga a direção do transceiver, e o
   * Chromium marca a faixa como `muted` em vez de disparar `ended`. Quem
   * escutava só `ended` ficava com o último quadro congelado na tela para
   * sempre.
   */
  onTrackMuted?(track: MediaStreamTrack, stream: MediaStream): void;
  onTrackUnmuted?(track: MediaStreamTrack, stream: MediaStream): void;
  onStateChange?(state: RTCPeerConnectionState): void;
}

/**
 * Uma conexão WebRTC com um peer, em um canal (voz ou tela).
 *
 * Usa o padrão "perfect negotiation": os dois lados podem adicionar faixas a
 * qualquer momento (host repassando áudio de um recém-chegado, convidado
 * começando a compartilhar tela) sem que ofertas simultâneas quebrem a
 * conexão. O lado "polite" desiste em caso de colisão; o "impolite" ignora a
 * oferta do outro. Aqui o host é sempre o impolite.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;

  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private closed = false;

  /**
   * Qualidade pedida em cada faixa que sai daqui.
   *
   * Guardar não é luxo: `setParameters` aplicado antes da primeira negociação
   * cai no vazio, porque o Chromium recria as `encodings` quando a descrição
   * local é montada. Como `addTrack` e `tuneSender` acontecem juntos, era
   * exatamente esse o caso — e a tela saía no bitrate conservador padrão até
   * que alguma outra coisa (mais alguém entrando, alguém compartilhando)
   * disparasse um `retuneSenders` e reaplicasse tudo. Daí a tela "consertar
   * sozinha" quando outra pessoa abria a dela.
   */
  private readonly tuned = new Map<RTCRtpSender, SenderQuality>();
  /**
   * Uma fila por faixa. `setParameters` carrega o `transactionId` do
   * `getParameters` que veio antes dele; dois ajustes sobrepostos fazem o
   * segundo nascer com um bilhete velho e ser recusado. Sem a fila, o pedido
   * perdido podia ser justamente o mais novo - a sala mudou de tamanho no meio
   * de uma renegociação e a qualidade certa era a que sumia.
   */
  private readonly tuning = new Map<RTCRtpSender, Promise<void>>();

  constructor(
    readonly peerId: string,
    readonly channel: RtcChannel,
    private readonly polite: boolean,
    private readonly events: PeerLinkEvents,
  ) {
    this.pc = new RTCPeerConnection({
      iceServers: runtime.iceServers,
      // `relay` esconde os IPs e prova que o TURN funciona, ao custo de passar
      // toda a mídia por ele: é escolha da pessoa, nunca padrão.
      iceTransportPolicy: runtime.forceRelay ? 'relay' : 'all',
    });

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        const sdp = this.pc.localDescription;
        if (sdp) this.send({ sdp: { type: sdp.type, sdp: tuneOpus(sdp.sdp) } });
      } catch (error) {
        console.warn('[rtc] falha ao criar oferta', error);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = ({ candidate }) => {
      // candidate null = fim da coleta; não precisa ser sinalizado.
      if (candidate) this.send({ candidate: candidate.toJSON() });
    };

    this.pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      this.events.onTrack(track, stream);
      // `mute`/`ended` cobrem tanto o fim explícito quanto a remoção da faixa.
      track.addEventListener('ended', () => this.events.onTrackEnded(track, stream));
      stream.addEventListener('removetrack', () => this.events.onTrackEnded(track, stream));
      track.addEventListener('mute', () => this.events.onTrackMuted?.(track, stream));
      track.addEventListener('unmute', () => this.events.onTrackUnmuted?.(track, stream));
    };

    this.pc.onconnectionstatechange = () => {
      // Negociação fechada: agora as `encodings` existem de verdade e o que
      // foi pedido antes da hora pode finalmente valer.
      if (this.pc.connectionState === 'connected') this.reapplyTuning();
      this.events.onStateChange?.(this.pc.connectionState);
    };

    // A mesma reaplicação para quem renegocia sem trocar de estado de conexão
    // (faixa adicionada numa conexão que já estava de pé).
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable') this.reapplyTuning();
    };
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender | null {
    if (this.closed) return null;
    return this.pc.addTrack(track, stream);
  }

  /**
   * Ajusta o que o navegador manda nesta faixa. Sem isso o Chromium fica num
   * bitrate conservador (~2 Mbps de vídeo, 32 kbps de áudio), que é o que faz
   * texto de tela ficar borrado e voz soar "telefone".
   */
  async tuneSender(sender: RTCRtpSender, quality: SenderQuality): Promise<void> {
    if (this.closed) return;
    this.tuned.set(sender, quality);
    await this.queueTuning(sender, quality);
  }

  /** Enfileira o ajuste atrás do que já estiver em curso nesta faixa. */
  private queueTuning(sender: RTCRtpSender, quality: SenderQuality): Promise<void> {
    const next = (this.tuning.get(sender) ?? Promise.resolve()).then(() =>
      this.applyTuning(sender, quality),
    );

    this.tuning.set(sender, next);
    void next.finally(() => {
      // Só limpa se ninguém entrou na fila depois, senão apagaria a corrente.
      if (this.tuning.get(sender) === next) this.tuning.delete(sender);
    });
    return next;
  }

  /** Reaplica em todas as faixas o que já tinha sido pedido. */
  private reapplyTuning(): void {
    if (this.closed) return;
    for (const [sender, quality] of this.tuned) {
      void this.queueTuning(sender, quality);
    }
  }

  private async applyTuning(sender: RTCRtpSender, quality: SenderQuality): Promise<void> {
    if (this.closed) return;
    try {
      const parameters = sender.getParameters();
      // `encodings` pode vir vazio antes da primeira negociação.
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = quality.maxBitrate;
        if (quality.maxFramerate) encoding.maxFramerate = quality.maxFramerate;
        // Sem escala explícita o Chromium escolhe encolher a imagem na primeira
        // dúvida e nunca mais volta a crescer: é o "borrado que não melhora".
        if (quality.scaleResolutionDownBy) {
          encoding.scaleResolutionDownBy = quality.scaleResolutionDownBy;
        }
        encoding.priority = 'high';
        encoding.networkPriority = 'high';
      }
      if (quality.degradationPreference) {
        parameters.degradationPreference = quality.degradationPreference;
      }
      await sender.setParameters(parameters);
    } catch (error) {
      console.warn('[rtc] não deu para ajustar a qualidade do envio', error);
    }
  }

  /**
   * Pede codecs melhores para vídeo. VP9/AV1 entregam bem mais nitidez que o
   * H264 no mesmo bitrate — o que importa muito para texto em tela compartilhada.
   */
  preferVideoCodecs(): void {
    if (this.closed) return;
    try {
      const capabilities = RTCRtpReceiver.getCapabilities('video');
      if (!capabilities) return;

      const rank = (mime: string): number => {
        const name = mime.toLowerCase();
        if (name.includes('av1')) return 0;
        if (name.includes('vp9')) return 1;
        if (name.includes('vp8')) return 2;
        return 3;
      };
      const ordered = [...capabilities.codecs].sort(
        (a, b) => rank(a.mimeType) - rank(b.mimeType),
      );

      for (const transceiver of this.pc.getTransceivers()) {
        if (transceiver.sender.track?.kind === 'video' && transceiver.setCodecPreferences) {
          transceiver.setCodecPreferences(ordered);
        }
      }
    } catch (error) {
      console.warn('[rtc] não deu para escolher o codec de vídeo', error);
    }
  }

  removeSender(sender: RTCRtpSender): void {
    this.tuned.delete(sender);
    this.tuning.delete(sender);
    if (this.closed) return;
    try {
      this.pc.removeTrack(sender);
    } catch {
      // conexão já pode ter sido fechada — nada a fazer
    }
  }

  async handleSignal(signal: IncomingSignal): Promise<void> {
    if (this.closed) return;

    if (signal.kind === 'ice') {
      if (!signal.candidate) return;
      try {
        await this.pc.addIceCandidate(signal.candidate as RTCIceCandidateInit);
      } catch (error) {
        // Candidato que chega antes da descrição remota (ou de uma oferta
        // ignorada) é esperado e pode ser descartado.
        if (!this.ignoreOffer) console.debug('[rtc] candidato descartado', error);
      }
      return;
    }

    const description = signal.sdp;
    if (!description) return;

    const readyForOffer =
      !this.makingOffer && (this.pc.signalingState === 'stable' || this.settingRemoteAnswer);
    const collision = description.type === 'offer' && !readyForOffer;

    this.ignoreOffer = !this.polite && collision;
    if (this.ignoreOffer) return;

    try {
      this.settingRemoteAnswer = description.type === 'answer';
      await this.pc.setRemoteDescription(description as RTCSessionDescriptionInit);
      this.settingRemoteAnswer = false;

      if (description.type === 'offer') {
        await this.pc.setLocalDescription();
        const local = this.pc.localDescription;
        if (local) this.send({ sdp: { type: local.type, sdp: tuneOpus(local.sdp) } });
      }
    } catch (error) {
      this.settingRemoteAnswer = false;
      console.warn('[rtc] falha ao aplicar sinalização', error);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tuned.clear();
    this.tuning.clear();
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;
    this.pc.close();
  }

  private send(payload: { sdp?: { type: string; sdp?: string }; candidate?: RTCIceCandidateInit }): void {
    void window.only.sendSignal({
      targetId: this.peerId,
      channel: this.channel,
      sdp: payload.sdp as { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string } | undefined,
      candidate: payload.candidate,
    });
  }
}
