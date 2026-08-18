import { OPUS_BITRATE } from './quality';

/**
 * Reescreve os parâmetros do Opus no SDP. É o único jeito de pedir estéreo e
 * bitrate alto: essas opções não existem em `setParameters`, só no fmtp.
 *
 * Trabalha linha a linha de propósito: SDP usa CRLF e mexer nisso com regex
 * multilinha é como se quebra a sessão inteira.
 */
export function tuneOpus(sdp: string | undefined): string | undefined {
  if (!sdp) return sdp;

  const wanted: Record<string, string> = {
    stereo: '1',
    'sprop-stereo': '1',
    maxaveragebitrate: String(OPUS_BITRATE),
    maxplaybackrate: '48000',
    useinbandfec: '1',
    usedtx: '0',
  };

  const lines = sdp.split(/\r\n|\n/);
  const payloads = new Set<string>();

  for (const line of lines) {
    const match = /^a=rtpmap:(\d+) opus\/48000\/2$/i.exec(line.trim());
    if (match) payloads.add(match[1]);
  }
  if (payloads.size === 0) return sdp;

  const output: string[] = [];
  const handled = new Set<string>();

  for (const line of lines) {
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (fmtp && payloads.has(fmtp[1])) {
      output.push(`a=fmtp:${fmtp[1]} ${mergeParams(fmtp[2], wanted)}`);
      handled.add(fmtp[1]);
      continue;
    }

    output.push(line);

    // Sem linha fmtp própria, cria uma logo abaixo do rtpmap.
    const rtpmap = /^a=rtpmap:(\d+) opus\/48000\/2$/i.exec(line.trim());
    if (rtpmap && !hasFmtp(lines, rtpmap[1])) {
      output.push(`a=fmtp:${rtpmap[1]} ${mergeParams('', wanted)}`);
      handled.add(rtpmap[1]);
    }
  }

  return output.join('\r\n');
}

function hasFmtp(lines: string[], payload: string): boolean {
  return lines.some((line) => line.startsWith(`a=fmtp:${payload} `));
}

/** Mantém o que o navegador já pediu e sobrescreve só o que nos interessa. */
function mergeParams(existing: string, wanted: Record<string, string>): string {
  const params = new Map<string, string>();
  for (const part of existing.split(';')) {
    const [key, value] = part.split('=');
    if (key.trim()) params.set(key.trim(), value ?? '');
  }
  for (const [key, value] of Object.entries(wanted)) params.set(key, value);
  return [...params].map(([key, value]) => (value ? `${key}=${value}` : key)).join(';');
}
