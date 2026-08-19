import { APP_PROTOCOL, TOKEN_LENGTH } from './constants';

export interface InviteInfo {
  host: string;
  port: number;
  token: string;
  /**
   * Endereço com TLS (`wss://`), sem porta explícita. É o caso do túnel: o
   * convite não aponta mais para um IP e uma porta abertos no roteador, e sim
   * para um nome que a borda da Cloudflare resolve.
   */
  secure?: boolean;
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Porta implícita de um convite `wss://`, que não carrega número. */
const TLS_PORT = 443;

/**
 * Token de sessão, regerado toda vez que o servidor sobe. Usa a fonte de
 * aleatoriedade criptográfica disponível (Node e navegador expõem a mesma API).
 */
export function generateToken(length = TOKEN_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += BASE62[byte % BASE62.length];
  }
  return out;
}

/**
 * Forma curta e copiável, a que o usuário vê: `203.0.113.5:51820#Xk29Ab3F` no
 * caminho direto, `wss://algo.trycloudflare.com#Xk29Ab3F` quando é túnel.
 */
export function buildInviteCode({ host, port, token, secure }: InviteInfo): string {
  if (secure) return `wss://${host}#${token}`;
  return `${host}:${port}#${token}`;
}

/** Forma URI, para quando o protocolo estiver registrado no Windows. */
export function buildInviteUrl({ host, port, token, secure }: InviteInfo): string {
  const params = new URLSearchParams({ host, port: String(port), token });
  if (secure) params.set('secure', '1');
  return `${APP_PROTOCOL}://join?${params.toString()}`;
}

/** Endereço WebSocket para onde o convidado disca. */
export function inviteAddress({ host, port, secure }: InviteInfo): string {
  // IPv6 literal precisa de colchetes na URL.
  const needsBrackets = host.includes(':') && !host.startsWith('[');
  const target = needsBrackets ? `[${host}]` : host;
  return secure ? `wss://${target}` : `ws://${target}:${port}`;
}

/** Como mostrar o destino para a pessoa, sem o token. */
export function inviteLabel({ host, port, secure }: InviteInfo): string {
  return secure ? host : `${host}:${port}`;
}

/**
 * Aceita tanto a forma curta quanto a URI — o usuário cola o que tiver em mãos.
 * Retorna null se o texto não for um convite válido.
 */
export function parseInvite(input: string): InviteInfo | null {
  const text = input.trim();
  if (!text) return null;

  if (text.toLowerCase().startsWith(`${APP_PROTOCOL}://`)) {
    return parseInviteUrl(text);
  }
  return parseInviteCode(text);
}

function parseInviteUrl(text: string): InviteInfo | null {
  try {
    const url = new URL(text);
    const host = url.searchParams.get('host');
    const token = url.searchParams.get('token');
    const secure = url.searchParams.get('secure') === '1';
    const port = secure ? TLS_PORT : Number(url.searchParams.get('port'));
    if (!host || !token || !isValidPort(port)) return null;
    return secure ? { host, port, token, secure } : { host, port, token };
  } catch {
    return null;
  }
}

function parseInviteCode(text: string): InviteInfo | null {
  const hashIndex = text.lastIndexOf('#');
  if (hashIndex === -1) return null;

  const address = text.slice(0, hashIndex);
  const token = text.slice(hashIndex + 1);
  if (!token) return null;

  // Convite de túnel: `wss://nome.trycloudflare.com`, sem porta para separar.
  const schemeMatch = /^wss?:\/\/(.+)$/i.exec(address.trim());
  if (schemeMatch) {
    const secure = address.trim().toLowerCase().startsWith('wss://');
    const rest = schemeMatch[1].replace(/\/+$/, '');
    const colonIndex = rest.lastIndexOf(':');
    const hasPort = colonIndex !== -1 && /^\d+$/.test(rest.slice(colonIndex + 1));
    const host = hasPort ? rest.slice(0, colonIndex) : rest;
    const port = hasPort ? Number(rest.slice(colonIndex + 1)) : secure ? TLS_PORT : 80;
    if (!host || !isValidPort(port)) return null;
    return secure ? { host, port, token, secure } : { host, port, token };
  }

  const colonIndex = address.lastIndexOf(':');
  if (colonIndex === -1) return null;

  const host = address.slice(0, colonIndex);
  const port = Number(address.slice(colonIndex + 1));
  if (!host || !isValidPort(port)) return null;

  return { host, port, token };
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}
