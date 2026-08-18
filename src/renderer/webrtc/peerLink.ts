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

  constructor(
    readonly peerId: string,
    readonly channel: RtcChannel,
    private readonly polite: boolean,
    private readonly events: PeerLinkEvents,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: runtime.iceServers });

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
    };

    this.pc.onconnectionstatechange = () => {
      this.events.onStateChange?.(this.pc.connectionState);
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
    try {
      const parameters = sender.getParameters();
      // `encodings` pode vir vazio antes da primeira negociação.
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = quality.maxBitrate;
        if (quality.maxFramerate) encoding.maxFramerate = quality.maxFramerate;
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
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
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
