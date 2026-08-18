import { ICE_SERVERS } from '@shared/constants';
import type { Settings } from '@shared/settings';

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
};

export function applyRuntimeSettings(settings: Settings): void {
  // Sem STUN, só candidatos locais: funciona na LAN e não contata ninguém.
  runtime.iceServers = settings.network.useStun ? ICE_SERVERS : [];
  runtime.screenBitrate = Math.round(settings.screen.maxBitrateMbps * 1_000_000);
  runtime.showCursor = settings.screen.showCursor;
}
