/**
 * Avisos sonoros sintetizados na hora.
 *
 * Gerar por código em vez de embutir arquivos de áudio: são três bipes curtos,
 * não vale carregar megabytes no instalador nem lidar com caminho de asset
 * dentro do `asar`.
 */

export type Cue = 'join' | 'leave' | 'message';

/** Frequências escolhidas para o ouvido distinguir sem precisar pensar. */
const CUES: Record<Cue, { notes: number[]; duration: number }> = {
  // Sobe: alguém chegou.
  join: { notes: [523.25, 783.99], duration: 0.09 },
  // Desce: alguém saiu.
  leave: { notes: [783.99, 523.25], duration: 0.09 },
  // Nota única, curta e discreta.
  message: { notes: [880], duration: 0.06 },
};

let context: AudioContext | null = null;

export function playCue(cue: Cue, volume: number): void {
  if (volume <= 0) return;

  try {
    context ??= new AudioContext();
    // O Chromium suspende o contexto até haver interação; retomar é barato.
    if (context.state === 'suspended') void context.resume();

    const { notes, duration } = CUES[cue];
    const gain = context.createGain();
    gain.connect(context.destination);
    // Teto baixo de propósito: aviso não pode competir com a voz de ninguém.
    gain.gain.value = Math.min(1, volume / 100) * 0.15;

    notes.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);

      const start = context!.currentTime + index * duration;
      oscillator.start(start);
      oscillator.stop(start + duration);
    });
  } catch (error) {
    console.warn('[only] não deu para tocar o aviso', error);
  }
}
