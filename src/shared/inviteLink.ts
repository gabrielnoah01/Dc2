import { APP_PROTOCOL, TOKEN_LENGTH } from './constants';

export interface InviteInfo {
  host: string;
  port: number;
  token: string;
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

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

/** Forma curta e copiável, a que o usuário vê: `203.0.113.5:51820#Xk29Ab3F`. */
export function buildInviteCode({ host, port, token }: InviteInfo): string {
  return `${host}:${port}#${token}`;
}

/** Forma URI, para quando o protocolo estiver registrado no Windows. */
export function buildInviteUrl({ host, port, token }: InviteInfo): string {
  const params = new URLSearchParams({ host, port: String(port), token });
  return `${APP_PROTOCOL}://join?${params.toString()}`;
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
    const port = Number(url.searchParams.get('port'));
    const token = url.searchParams.get('token');
    if (!host || !token || !isValidPort(port)) return null;
    return { host, port, token };
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
