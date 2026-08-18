import { networkInterfaces } from 'node:os';

/**
 * Descobre o IP público via uma única chamada externa. Isso serve só para
 * *exibir* o endereço no link de convite — não é sinalização, não há servidor
 * intermediário na conexão em si.
 */
export async function resolvePublicIp(timeoutMs = 4000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { ip?: string };
    return typeof data.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * IP na rede local — sempre funciona para amigos no mesmo Wi-Fi, mesmo quando
 * UPnP falha ou a operadora usa CGNAT.
 */
export function resolveLocalIp(): string | null {
  const interfaces = networkInterfaces();
  const candidates: string[] = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      candidates.push(address.address);
    }
  }

  // Prioriza faixas domésticas comuns antes de qualquer adaptador virtual.
  const preferred = candidates.find(
    (ip) => ip.startsWith('192.168.') || ip.startsWith('10.'),
  );
  return preferred ?? candidates[0] ?? null;
}
