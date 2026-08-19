import type { PeerLink } from './peerLink';

/**
 * Diagnóstico de rede por conexão, lido do `getStats()` do próprio WebRTC.
 *
 * Existe porque "está travando" não é diagnóstico: quando alguém cai no meio
 * da conversa, ninguém sabe dizer se foi o Wi-Fi de quem caiu, o upload de
 * quem transmite ou a rede do host. Com número na tela, dá para apontar o
 * culpado em vez de reiniciar tudo na esperança.
 *
 * Tudo aqui é derivado de duas amostras seguidas — o WebRTC só entrega
 * contadores acumulados, e taxa é o que interessa para uma pessoa olhando.
 */

export type NetGrade = 'good' | 'fair' | 'poor' | 'unknown';

export interface PeerHealth {
  peerId: string;
  grade: NetGrade;
  /** Ida e volta em ms, do par candidato em uso. */
  rttMs: number | null;
  /** Perda de pacote no intervalo, em % do que era esperado chegar. */
  lossPercent: number | null;
  /** Bits por segundo no intervalo. */
  downBps: number;
  upBps: number;
  /** `false` enquanto o ICE ainda não fechou, ou depois que caiu. */
  connected: boolean;
}

export interface NetHealth {
  peers: PeerHealth[];
  /** A pior nota da sala: é ela que decide a cor do indicador. */
  grade: NetGrade;
  downBps: number;
  upBps: number;
}

export const EMPTY_HEALTH: NetHealth = { peers: [], grade: 'unknown', downBps: 0, upBps: 0 };

/** Intervalo entre amostras. Abaixo disso o ruído domina a conta de taxa. */
export const SAMPLE_INTERVAL_MS = 2_000;

interface Snapshot {
  at: number;
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsLost: number;
}

/**
 * Guarda a leitura anterior de cada conexão para conseguir falar em taxa.
 * Uma instância por sessão; some junto com ela.
 */
export class NetHealthProbe {
  private readonly previous = new Map<string, Snapshot>();

  async sample(links: Iterable<PeerLink>): Promise<NetHealth> {
    const peers: PeerHealth[] = [];
    const byPeer = new Map<string, PeerLink[]>();

    for (const link of links) {
      const list = byPeer.get(link.peerId);
      if (list) list.push(link);
      else byPeer.set(link.peerId, [link]);
    }

    for (const [peerId, group] of byPeer) {
      const health = await this.samplePeer(peerId, group);
      if (health) peers.push(health);
    }

    // Conexão que sumiu não pode deixar o último estado envenenando a próxima.
    for (const key of [...this.previous.keys()]) {
      if (!byPeer.has(key)) this.previous.delete(key);
    }

    const downBps = peers.reduce((total, peer) => total + peer.downBps, 0);
    const upBps = peers.reduce((total, peer) => total + peer.upBps, 0);
    return { peers, grade: worstGrade(peers), downBps, upBps };
  }

  private async samplePeer(peerId: string, group: PeerLink[]): Promise<PeerHealth | null> {
    const at = Date.now();
    let bytesIn = 0;
    let bytesOut = 0;
    let packetsIn = 0;
    let packetsLost = 0;
    let rttMs: number | null = null;
    let connected = false;

    for (const link of group) {
      if (link.pc.connectionState === 'connected') connected = true;

      let report: RTCStatsReport;
      try {
        report = await link.pc.getStats();
      } catch {
        // Conexão fechando no meio da leitura: não é erro que mereça barulho.
        continue;
      }

      report.forEach((entry) => {
        const stat = entry as Record<string, unknown>;
        const type = stat.type;

        if (type === 'inbound-rtp') {
          bytesIn += num(stat.bytesReceived);
          packetsIn += num(stat.packetsReceived);
          packetsLost += num(stat.packetsLost);
        } else if (type === 'outbound-rtp') {
          bytesOut += num(stat.bytesSent);
        } else if (type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
          const rtt = num(stat.currentRoundTripTime) * 1000;
          // Fica com a pior via ativa: é ela que a pessoa sente.
          if (rtt > 0 && (rttMs === null || rtt > rttMs)) rttMs = rtt;
        }
      });
    }

    const snapshot: Snapshot = { at, bytesIn, bytesOut, packetsIn, packetsLost };
    const before = this.previous.get(peerId);
    this.previous.set(peerId, snapshot);

    if (!before) {
      // Primeira leitura só serve de referência: taxa ainda não existe.
      return { peerId, grade: 'unknown', rttMs, lossPercent: null, downBps: 0, upBps: 0, connected };
    }

    const seconds = (at - before.at) / 1000;
    if (seconds <= 0) return null;

    // Contador que anda para trás significa conexão recriada: zera em vez de
    // inventar pico absurdo de banda.
    const downBps = rate(bytesIn - before.bytesIn, seconds);
    const upBps = rate(bytesOut - before.bytesOut, seconds);

    const arrived = packetsIn - before.packetsIn;
    const lost = packetsLost - before.packetsLost;
    const expected = arrived + lost;
    const lossPercent = expected > 0 && lost >= 0 ? (lost / expected) * 100 : null;

    return {
      peerId,
      grade: gradeOf({ rttMs, lossPercent, connected, expected }),
      rttMs,
      lossPercent,
      downBps,
      upBps,
      connected,
    };
  }
}

function rate(deltaBytes: number, seconds: number): number {
  if (deltaBytes <= 0) return 0;
  return Math.round((deltaBytes * 8) / seconds);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Os cortes são de experiência de conversa, não de norma: acima de 3% de perda
 * a voz já pica, e 300 ms de ida e volta é onde as pessoas começam a se
 * atropelar falando.
 */
function gradeOf(input: {
  rttMs: number | null;
  lossPercent: number | null;
  connected: boolean;
  expected: number;
}): NetGrade {
  if (!input.connected) return 'poor';
  if (input.lossPercent === null && input.rttMs === null) return 'unknown';
  if ((input.lossPercent ?? 0) > 5 || (input.rttMs ?? 0) > 300) return 'poor';
  if ((input.lossPercent ?? 0) > 1.5 || (input.rttMs ?? 0) > 150) return 'fair';
  return 'good';
}

const ORDER: Record<NetGrade, number> = { poor: 0, fair: 1, good: 2, unknown: 3 };

function worstGrade(peers: PeerHealth[]): NetGrade {
  let worst: NetGrade = 'unknown';
  for (const peer of peers) {
    if (ORDER[peer.grade] < ORDER[worst]) worst = peer.grade;
  }
  return worst;
}

/** "1,2 Mb/s" — abreviação para caber num rodapé, não para relatório. */
export function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mb/s`;
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} kb/s`;
  return `${Math.max(0, Math.round(bps))} b/s`;
}
