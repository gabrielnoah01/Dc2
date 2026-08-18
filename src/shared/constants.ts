/** Nome do produto, usado na UI, no instalador e no esquema de link. */
export const APP_NAME = 'Only';

/** Esquema do link de convite: only://join?host=...&port=...&token=... */
export const APP_PROTOCOL = 'only';

/** Porta padrão sugerida ao criar um servidor. */
export const DEFAULT_PORT = 51820;

/**
 * Versão do protocolo entre host e convidado. Suba isto sempre que mudar o
 * formato de qualquer mensagem: é o que troca um crash por um aviso claro
 * quando alguém está com o app desatualizado.
 */
export const PROTOCOL_VERSION = 2;

/** Tamanho do token de sessão gerado a cada vez que o servidor sobe. */
export const TOKEN_LENGTH = 8;

/** Limite de caracteres de uma mensagem de chat. */
export const MAX_CHAT_LENGTH = 2000;

/** Limite de caracteres de um nome de usuário. */
export const MAX_USERNAME_LENGTH = 24;

/**
 * ICE para a mídia (voz/tela). Na mesma rede Wi-Fi os candidatos locais bastam
 * e esta lista pode ficar vazia. Pela internet, porém, os dois lados só sabem
 * seus IPs privados: sem um STUN para descobrir o endereço público, o áudio
 * não conecta mesmo com a porta do WebSocket aberta.
 *
 * O STUN só responde "qual é o seu IP público" — nenhum áudio, tela ou chat
 * passa por ele, então isso não reintroduz um servidor central. Deixe a lista
 * vazia se quiser um app 100% offline restrito à LAN.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
