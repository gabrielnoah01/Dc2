/**
 * Supressão de ruído em camadas, por cima da que o Chromium já faz.
 *
 * A supressão do navegador é boa em ruído estacionário (ventilador, ar,
 * chiado), mas ela é conservadora de propósito e deixa passar justamente o que
 * mais incomoda numa chamada: teclado, clique de mouse, a TV do outro cômodo,
 * a conversa de outra pessoa na sala. Nada disso é estacionário, então ela não
 * reconhece como ruído.
 *
 * O que fica aqui é a segunda camada: um passa-alta que tira o retumbo de mesa
 * e ventilador, e um portão com expansor que só deixa o canal aberto quando o
 * que chega está acima do silêncio *daquele* microfone. O piso de ruído é
 * medido sozinho e sem parar, então não existe "ajuste o limiar" para o usuário
 * errar — um microfone chiado e um bom acabam no mesmo lugar.
 *
 * O portão roda num AudioWorklet (thread de áudio, amostra a amostra). Fazer
 * isso no thread principal com timer seria pior de duas formas: o corte
 * chegaria atrasado, comendo o começo das palavras, e pararia de funcionar
 * justamente com a janela minimizada, quando o Chromium estrangula os timers.
 */
import type { NoiseSuppressionLevel } from '@shared/settings';
import gateProcessorUrl from './noiseGate.worklet.js?url';

interface NoiseProfile {
  /** Rótulo curto para a interface. */
  label: string;
  description: string;
  /** Deixa a supressão do próprio Chromium ligada. */
  browserSuppression: boolean;
  /** Corte do passa-alta, em Hz. Voz humana começa por volta dos 85 Hz. */
  highpassHz: number;
  /** Quantos dB acima do piso de ruído contam como voz. */
  thresholdDb: number;
  /** Quanto o canal fechado é atenuado, em dB. */
  floorGainDb: number;
  /** Subida do portão (ms). Curta demais estala; longa demais come sílaba. */
  attackMs: number;
  /** Descida do portão (ms). */
  releaseMs: number;
  /** Quanto o portão fica aberto depois que o nível cai (ms). */
  holdMs: number;
}

/**
 * Os três degraus. A diferença entre eles é quase toda no limiar e no quanto o
 * canal fechado é atenuado: quanto mais agressivo, mais perto do silêncio
 * absoluto o fundo vai — e mais fácil fica engolir um começo de frase falado
 * baixo. Daí existirem três em vez de um interruptor.
 */
export const NOISE_PROFILES: Record<Exclude<NoiseSuppressionLevel, 'off'>, NoiseProfile> = {
  light: {
    label: 'Leve',
    description: 'Só o essencial. Preserva voz baixa e respiração.',
    browserSuppression: true,
    highpassHz: 70,
    thresholdDb: 6,
    floorGainDb: -12,
    attackMs: 5,
    releaseMs: 220,
    holdMs: 250,
  },
  medium: {
    label: 'Média',
    description: 'Corta teclado, ventilador e fundo de casa.',
    browserSuppression: true,
    highpassHz: 90,
    thresholdDb: 9,
    floorGainDb: -24,
    attackMs: 4,
    releaseMs: 160,
    holdMs: 190,
  },
  max: {
    label: 'Máxima',
    description: 'Silêncio entre as frases. Pode comer voz muito baixa.',
    browserSuppression: true,
    highpassHz: 110,
    thresholdDb: 13,
    floorGainDb: -60,
    attackMs: 3,
    releaseMs: 120,
    holdMs: 150,
  },
};

/** Uma vez por contexto: registrar o mesmo módulo duas vezes é erro. */
const registered = new WeakSet<BaseAudioContext>();

/**
 * Carrega o processador no contexto de áudio.
 *
 * O arquivo do worklet é trazido por URL (`?url` no import), o que faz o
 * empacotador copiá-lo como asset de verdade em vez de embutir no pacote. Ele
 * então vem da própria origem da aplicação — embutir o código e servir por
 * `blob:` seria mais curto, mas exigiria abrir o CSP (hoje `default-src
 * 'self'`) para script em blob, o que é caro demais pelo atalho.
 */
async function registerGate(context: BaseAudioContext): Promise<boolean> {
  if (registered.has(context)) return true;
  if (!context.audioWorklet) return false;

  try {
    await context.audioWorklet.addModule(gateProcessorUrl);
    registered.add(context);
    return true;
  } catch (error) {
    console.warn('[voz] portão de ruído indisponível', error);
    return false;
  }
}

/**
 * A cadeia de supressão, com entrada e saída fixas.
 *
 * Os dois pontos nunca mudam de identidade: quem liga o microfone na entrada e
 * a saída no resto do caminho faz isso uma vez só. Trocar de nível remonta o
 * miolo por dentro sem que ninguém lá fora precise reconectar nada — e sem
 * tocar na faixa que sai, que é o que evita renegociar a conexão inteira só
 * porque alguém mexeu num seletor.
 */
export class NoiseSuppressionChain {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly highpass: BiquadFilterNode;
  private gate: AudioWorkletNode | null;
  private level: NoiseSuppressionLevel | null = null;

  private constructor(
    private readonly context: AudioContext,
    gate: AudioWorkletNode | null,
  ) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.gate = gate;

    this.highpass = context.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = NOISE_PROFILES.medium.highpassHz;
    // Q baixo = curva suave. Um passa-alta ressonante colore a voz.
    this.highpass.Q.value = 0.7;

    this.input.connect(this.output);
  }

  static async create(context: AudioContext): Promise<NoiseSuppressionChain> {
    const ready = await registerGate(context);
    // Sem worklet a cadeia ainda serve: o passa-alta sozinho já resolve o
    // retumbo, e o resto degrada para "como era antes" em vez de quebrar.
    const gate = ready
      ? new AudioWorkletNode(context, 'noise-gate', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: NOISE_PROFILES.medium,
        })
      : null;
    return new NoiseSuppressionChain(context, gate);
  }

  setLevel(level: NoiseSuppressionLevel): void {
    if (level === this.level) return;
    this.level = level;

    this.input.disconnect();
    this.highpass.disconnect();
    this.gate?.disconnect();

    if (level === 'off') {
      this.input.connect(this.output);
      return;
    }

    const profile = NOISE_PROFILES[level];
    this.highpass.frequency.setTargetAtTime(profile.highpassHz, this.context.currentTime, 0.05);
    this.gate?.port.postMessage(profile);

    this.input.connect(this.highpass);
    if (this.gate) {
      this.highpass.connect(this.gate);
      this.gate.connect(this.output);
    } else {
      this.highpass.connect(this.output);
    }
  }

  dispose(): void {
    this.input.disconnect();
    this.highpass.disconnect();
    this.gate?.disconnect();
    this.output.disconnect();
    this.gate = null;
  }
}

/** O que pedir ao `getUserMedia`: a primeira camada continua sendo do navegador. */
export function browserSuppression(level: NoiseSuppressionLevel): boolean {
  return level !== 'off' && NOISE_PROFILES[level].browserSuppression;
}
