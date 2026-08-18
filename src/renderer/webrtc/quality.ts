/**
 * Todos os parâmetros de qualidade num lugar só, para dar para afinar sem
 * caçar número mágico espalhado pelos gerentes de mídia.
 *
 * Os padrões do Chromium são conservadores porque ele mira em conexões ruins:
 * ~2 Mbps de vídeo e 32 kbps de áudio mono. Numa rede local — que é o caso de
 * uso principal aqui — isso é desperdício de banda sobrando.
 */

export interface SenderQuality {
  maxBitrate: number;
  maxFramerate?: number;
  /**
   * `maintain-framerate` sacrifica resolução para não perder quadro (jogo,
   * vídeo); `maintain-resolution` faz o contrário (texto, código, planilha).
   */
  degradationPreference?: RTCDegradationPreference;
}

/** Bitrate do Opus, aplicado via fmtp no SDP. 128 kbps estéreo ≈ qualidade de música. */
export const OPUS_BITRATE = 128_000;

/** Áudio: o dobro do teto que o Chromium usa sozinho, em estéreo. */
export const VOICE_SENDER: SenderQuality = {
  maxBitrate: OPUS_BITRATE,
};

/**
 * Captura do microfone. Mantemos cancelamento de eco e supressão de ruído
 * ligados (sem eles, alto-falante vira microfonia), mas pedimos 48 kHz estéreo
 * para o processamento não jogar a taxa lá para baixo.
 */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48_000,
  sampleSize: 16,
  channelCount: 2,
};

// ---------------------------------------------------------------------------
// Modos de transmissão de tela
// ---------------------------------------------------------------------------

export type SharePresetId = 'fluid' | 'sharp';

export interface SharePreset {
  id: SharePresetId;
  label: string;
  description: string;
  constraints: MediaTrackConstraints;
  sender: SenderQuality;
  /**
   * Dica para o codificador. `motion` aceita borrar um pouco para manter a
   * cadência; `detail` faz o oposto, que é o que mantém texto legível.
   */
  contentHint: 'motion' | 'detail';
}

/**
 * Não dá para ter 120 fps e 1440p ao mesmo tempo numa banda razoável — são
 * 8x mais pixels por segundo. Em vez de escolher escondido, os dois modos
 * ficam visíveis na hora de compartilhar.
 *
 * Sobre os 120 fps: pedimos, mas quem manda é a fonte. A captura de tela do
 * Windows entrega no máximo a taxa de atualização do monitor, então num
 * monitor de 60 Hz o resultado real vai ser 60 fps por mais que se peça 120.
 */
export const SHARE_PRESETS: Record<SharePresetId, SharePreset> = {
  fluid: {
    id: 'fluid',
    label: 'Fluidez — 720p a 120 fps',
    description: 'Movimento suave. Melhor para jogo e vídeo.',
    constraints: {
      width: { max: 1280 },
      height: { max: 720 },
      frameRate: { ideal: 120, max: 120 },
    },
    sender: {
      // 720p120 tem a mesma carga de pixels que 1080p60; 6 Mbps segura bem.
      maxBitrate: 6_000_000,
      maxFramerate: 120,
      degradationPreference: 'maintain-framerate',
    },
    contentHint: 'motion',
  },
  sharp: {
    id: 'sharp',
    label: 'Nitidez — 1440p a 60 fps',
    description: 'Imagem detalhada. Melhor para código e leitura.',
    constraints: {
      width: { max: 2560 },
      height: { max: 1440 },
      frameRate: { ideal: 60, max: 60 },
    },
    sender: {
      maxBitrate: 8_000_000,
      maxFramerate: 60,
      degradationPreference: 'maintain-resolution',
    },
    contentHint: 'detail',
  },
};

export const DEFAULT_PRESET: SharePresetId = 'fluid';

/**
 * Quando o host repassa a tela de outra pessoa, ele já gasta banda com cada
 * destinatário. Aí o teto cai, para o upload dele não virar o gargalo de todo
 * mundo. O `maxFramerate` alto continua: cortar quadro no repasse anularia
 * justamente o que o modo fluidez foi buscar.
 */
export function forwardQuality(sender: SenderQuality): SenderQuality {
  return {
    ...sender,
    maxBitrate: Math.round(sender.maxBitrate * 0.65),
  };
}
