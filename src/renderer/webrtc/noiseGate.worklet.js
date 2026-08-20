/**
 * O portão de ruído, rodando no thread de áudio.
 *
 * Arquivo separado e em JavaScript puro de propósito: um AudioWorklet é
 * buscado por URL pelo próprio motor de áudio, fora do grafo de módulos do
 * app. Ele é carregado com `?url`, o que faz o empacotador copiá-lo como
 * arquivo de verdade em vez de embutir — assim a origem continua sendo a
 * própria aplicação e o CSP (`default-src 'self'`) segue fechado, sem precisar
 * abrir exceção para `blob:` só por causa disto.
 *
 * A configuração chega pronta em dB/ms (veja `noiseSuppression.ts`); aqui ela
 * só é convertida para os coeficientes que o laço usa.
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Piso de ruído estimado, em RMS linear. Começa alto para o portão não
    // abrir escancarado no primeiro bloco, antes de ter medido qualquer coisa.
    this.floor = 0.01;
    this.gain = 0;
    this.holdLeft = 0;
    this.open = false;
    this.apply(options.processorOptions || {});
    this.port.onmessage = (event) => this.apply(event.data || {});
  }

  apply(config) {
    const rate = sampleRate || 48000;
    const block = 128 / rate;

    this.threshold = Math.pow(10, (config.thresholdDb || 9) / 20);
    this.floorGain = Math.pow(10, (config.floorGainDb || -24) / 20);
    // Fechar exige cair mais do que foi preciso para abrir: sem essa folga o
    // portão treme, abrindo e fechando várias vezes por segundo em voz parada.
    this.hysteresis = Math.pow(10, -4 / 20);
    this.attack = Math.exp(-1 / (rate * ((config.attackMs || 4) / 1000)));
    this.release = Math.exp(-1 / (rate * ((config.releaseMs || 160) / 1000)));
    this.holdBlocks = Math.ceil((config.holdMs || 190) / 1000 / block);
    // O piso desce rápido atrás do silêncio e sobe bem devagar, para uma frase
    // longa não ser confundida com o ruído de fundo tendo ficado mais alto.
    this.floorDown = 1 - Math.exp(-block / 0.15);
    this.floorUp = 1 - Math.exp(-block / 8);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const frames = input[0].length;

    // Nível do bloco somando os canais: ruído em um canal só ainda é ruído.
    let sum = 0;
    for (let c = 0; c < input.length; c += 1) {
      const channel = input[c];
      for (let i = 0; i < frames; i += 1) sum += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sum / Math.max(1, frames * input.length));

    const openLevel = this.floor * this.threshold;
    if (rms > openLevel) {
      this.open = true;
      this.holdLeft = this.holdBlocks;
    } else if (this.open) {
      if (rms > openLevel * this.hysteresis) this.holdLeft = this.holdBlocks;
      else if (this.holdLeft > 0) this.holdLeft -= 1;
      else this.open = false;
    }

    // O piso só é medido com o portão fechado. Medir durante a fala faria a
    // própria voz virar "ruído de fundo" e o portão se fechar sobre ela.
    if (!this.open) {
      const coefficient = rms < this.floor ? this.floorDown : this.floorUp;
      this.floor += (rms - this.floor) * coefficient;
      if (this.floor < 1e-6) this.floor = 1e-6;
    }

    const target = this.open ? 1 : this.floorGain;
    const coefficient = target > this.gain ? this.attack : this.release;
    let last = this.gain;

    for (let c = 0; c < output.length; c += 1) {
      const source = input[Math.min(c, input.length - 1)];
      const destination = output[c];
      // Cada canal reconstrói o ganho a partir do mesmo ponto de partida, para
      // os dois saírem idênticos; senão o estéreo abriria torto.
      let gain = this.gain;
      for (let i = 0; i < frames; i += 1) {
        gain = target + (gain - target) * coefficient;
        destination[i] = source[i] * gain;
      }
      last = gain;
    }

    this.gain = last;
    return true;
  }
}

registerProcessor('noise-gate', NoiseGateProcessor);
