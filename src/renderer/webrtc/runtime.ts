import { ICE_SERVERS } from '@shared/constants';
import { buildIceServers, type Settings } from '@shared/settings';
import type { RoomFeatures } from '@shared/protocol';

/**
 * Preferências que precisam ser lidas por código fora do React (o `PeerLink`
 * cria conexões em callbacks de WebRTC, longe de qualquer hook). Um objeto
 * mutável mantido em dia pela store é mais simples do que enfiar props por
 * cinco camadas.
 */
export const runtime = {
  iceServers: ICE_SERVERS as RTCIceServer[],
  /** Teto de banda por tela, já em bits por segundo. */
  screenBitrate: 6_000_000,
  showCursor: true,
  /**
   * Malha: cada convidado abre conexão com todo mundo em vez de só com o host.
   * Quem manda é a sala (o host anuncia na entrada), não a preferência local.
   */
  mesh: false,
  /**
   * Malha: com TURN caro ou host generoso a política muda, então quem cria a
   * conexão pergunta aqui em vez de decidir sozinho.
   */
  forceRelay: false,
};

export function applyRuntimeSettings(settings: Settings): void {
  // Sem STUN, só candidatos locais: funciona na LAN e não contata ninguém.
  // Os servidores da pessoa entram junto (ou sozinhos, se o STUN público estiver
  // desligado) — é o que permite trocar a infraestrutura inteira por uma própria.
  runtime.iceServers = buildIceServers(settings.network, ICE_SERVERS);
  runtime.forceRelay = settings.network.forceRelay;
  runtime.screenBitrate = Math.round(settings.screen.maxBitrateMbps * 1_000_000);
  runtime.showCursor = settings.screen.showCursor;
}

/**
 * O combinado da sala, que chega no aceite. Vale mais que a preferência local:
 * dois lados com topologias diferentes não fecham conexão nenhuma.
 */
export function applyRoomFeatures(features: RoomFeatures): void {
  runtime.mesh = features.mesh;
}
