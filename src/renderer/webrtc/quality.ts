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
   * Divisor de resolução. `1` proíbe o Chromium de encolher a imagem por
   * conta própria — é o que evita a tela chegar borrada mesmo com banda de
   * sobra, porque o encoder decide a escala uma vez e não volta atrás sozinho.
   */
  scaleResolutionDownBy?: number;
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
 * Os dois modos ficam visíveis na hora de compartilhar em vez de escolhidos
 * escondido, porque a troca entre cadência e detalhe depende do que está na
 * tela — jogo e planilha querem coisas opostas.
 *
 * Por que 1080p60 e não 720p120: a fonte manda mais que o pedido. A captura de
 * tela do Windows entrega no máximo a taxa de atualização do monitor, então em
 * monitor de 60 Hz (a maioria) pedir 120 fps só fazia o encoder reservar
 * orçamento para quadros que nunca chegavam — e pagar essa reserva encolhendo
 * a resolução. O resultado era 720p borrado entregando 60 fps de verdade.
 * Pedindo 1080p60 o orçamento inteiro vai para os quadros que existem.
 */
export const SHARE_PRESETS: Record<SharePresetId, SharePreset> = {
  fluid: {
    id: 'fluid',
    label: 'Fluidez — 1080p a 60 fps',
    description: 'Movimento suave. Melhor para jogo e vídeo.',
    constraints: {
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    },
    sender: {
      maxBitrate: 8_000_000,
      maxFramerate: 60,
      scaleResolutionDownBy: 1,
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
      maxBitrate: 10_000_000,
      maxFramerate: 60,
      scaleResolutionDownBy: 1,
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

// ---------------------------------------------------------------------------
// Estado da janela
// ---------------------------------------------------------------------------

/**
 * O quanto a janela está sendo olhada agora.
 *
 * - `active`: em primeiro plano, alguém está vendo.
 * - `background`: aberta mas sem foco (outra janela por cima).
 * - `hidden`: minimizada, na bandeja ou totalmente coberta.
 *
 * Isso vale muito mais que parece: decodificar e pintar várias telas 1080p60
 * custa GPU e CPU o tempo todo, mesmo quando ninguém está olhando. Num jogo em
 * tela cheia com o Only minimizado, esse trabalho sai direto do orçamento de
 * quadros do jogo.
 */
export type WindowActivity = 'active' | 'background' | 'hidden';

/**
 * Redução aplicada ao *envio* quando a janela não está em primeiro plano.
 *
 * Fica desligado por padrão de propósito. Minimizar o Only enquanto compartilha
 * é justamente o caso de quem está jogando em tela cheia — cortar a qualidade
 * bem aí pioraria a tela para quem assiste no exato momento em que ela importa.
 * Quem prefere trocar essa qualidade por FPS liga nas preferências.
 */
export const SEND_THROTTLE: Record<WindowActivity, { bitrate: number; framerate: number }> = {
  active: { bitrate: 1, framerate: 1 },
  background: { bitrate: 0.6, framerate: 0.5 },
  hidden: { bitrate: 0.25, framerate: 0.25 },
};

/** Aplica a redução de segundo plano sobre uma qualidade já calculada. */
export function throttledQuality(
  sender: SenderQuality,
  activity: WindowActivity,
): SenderQuality {
  const factor = SEND_THROTTLE[activity];
  if (factor.bitrate === 1 && factor.framerate === 1) return sender;
  return {
    ...sender,
    maxBitrate: Math.round(sender.maxBitrate * factor.bitrate),
    maxFramerate: sender.maxFramerate
      ? Math.max(10, Math.round(sender.maxFramerate * factor.framerate))
      : undefined,
    // Encolher a imagem é o que de fato economiza encoder; só o bitrate faria
    // o Chromium gastar a mesma CPU para produzir quadros mais feios. Multiplica
    // o divisor do modo em vez de trocá-lo, para não desfazer o que o preset
    // já tinha pedido.
    scaleResolutionDownBy:
      (sender.scaleResolutionDownBy ?? 1) * (activity === 'hidden' ? 2 : 1),
  };
}
