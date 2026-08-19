import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { get } from 'node:https';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

/**
 * Saída de emergência para quem não consegue abrir a porta no roteador.
 *
 * A ideia: em vez de o convidado discar direto para o IP de casa, quem sobe o
 * servidor abre um túnel de saída até a borda da Cloudflare e o convite vira um
 * endereço `wss://alguma-coisa.trycloudflare.com`. Como a conexão parte de
 * dentro para fora, nada precisa ser liberado no roteador — funciona igual
 * atrás de CGNAT da operadora, que é o caso em que nenhum port-forward resolve.
 *
 * O preço: o tráfego de sinalização (o WebSocket de texto e controle) passa
 * pela Cloudflare. A mídia continua P2P e, com E2EE, o conteúdo do chat
 * continua ilegível para o intermediário.
 *
 * O binário do `cloudflared` não vai no instalador (~35 MB por plataforma).
 * Ele é baixado na primeira vez que alguém precisa do túnel e fica guardado no
 * userData — da segunda em diante a subida é imediata e offline.
 */

export type TunnelStage =
  | { stage: 'downloading'; percent: number }
  | { stage: 'starting' }
  | { stage: 'ready'; hostname: string }
  | { stage: 'failed'; detail: string };

export interface TunnelEvents {
  onStage(stage: TunnelStage): void;
}

/** Nome no disco por plataforma — só para não confundir binários entre SOs. */
function binaryName(): string {
  return platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/**
 * Onde a Cloudflare publica o binário. Sempre `latest` de propósito: uma
 * versão fixada aqui envelhece e o serviço recusa clientes muito antigos.
 */
function downloadUrl(): string | null {
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
  const cpu = arch();
  switch (platform()) {
    case 'win32':
      // Não existe build para Windows ARM; o x64 roda sob emulação.
      return `${base}/cloudflared-windows-${cpu === 'ia32' ? '386' : 'amd64'}.exe`;
    case 'darwin':
      return `${base}/cloudflared-darwin-${cpu === 'arm64' ? 'arm64' : 'amd64'}.tgz`;
    case 'linux':
      if (cpu === 'arm64') return `${base}/cloudflared-linux-arm64`;
      if (cpu === 'arm') return `${base}/cloudflared-linux-arm`;
      return `${base}/cloudflared-linux-amd64`;
    default:
      return null;
  }
}

function binaryPath(): string {
  return join(app.getPath('userData'), 'bin', binaryName());
}

async function exists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    // Download interrompido deixa arquivo curto: melhor rebaixar do que travar.
    return info.isFile() && info.size > 1_000_000;
  } catch {
    return false;
  }
}

/** GET seguindo redirect — o link `latest` é sempre um 302 para o CDN. */
function download(url: string, target: string, onPercent: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { 'user-agent': 'only-app' } }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, target, onPercent).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`download falhou (HTTP ${status})`));
        return;
      }

      const total = Number(response.headers['content-length'] ?? 0);
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) onPercent(Math.min(99, Math.round((received / total) * 100)));
      });

      pipeline(response, createWriteStream(target)).then(resolve, reject);
    });
    request.on('error', reject);
    request.setTimeout(60_000, () => request.destroy(new Error('download travou')));
  });
}

/**
 * Garante o binário no disco. Baixa para um arquivo temporário e só então
 * renomeia: se a rede cair no meio, nada de meio-baixado assume o lugar.
 */
async function ensureBinary(events: TunnelEvents): Promise<string> {
  const target = binaryPath();
  if (await exists(target)) return target;

  const url = downloadUrl();
  if (!url) throw new Error('túnel não disponível nesta plataforma');

  await mkdir(join(app.getPath('userData'), 'bin'), { recursive: true });
  const temporary = join(tmpdir(), `cloudflared-${Date.now()}${url.endsWith('.tgz') ? '.tgz' : ''}`);

  events.onStage({ stage: 'downloading', percent: 0 });
  await download(url, temporary, (percent) => events.onStage({ stage: 'downloading', percent }));

  if (url.endsWith('.tgz')) {
    // macOS empacota; `tar` existe no sistema desde sempre.
    const folder = join(tmpdir(), `cloudflared-${Date.now()}-out`);
    await mkdir(folder, { recursive: true });
    await execFileAsync('tar', ['-xzf', temporary, '-C', folder]);
    await rename(join(folder, 'cloudflared'), target);
    await rm(folder, { recursive: true, force: true });
  } else {
    await rename(temporary, target);
  }
  await rm(temporary, { force: true });

  if (platform() !== 'win32') await chmod(target, 0o755);
  return target;
}

let child: ChildProcess | null = null;

/**
 * Sobe o túnel apontando para o servidor local e devolve o hostname público.
 * Falhar aqui nunca é fatal: a sala já está de pé no IP local, o túnel é só a
 * ponte extra para quem vem de fora.
 */
export async function startTunnel(
  port: number,
  events: TunnelEvents,
  timeoutMs = 45_000,
): Promise<string | null> {
  await stopTunnel();

  try {
    const binary = await ensureBinary(events);
    events.onStage({ stage: 'starting' });

    return await new Promise<string | null>((resolve) => {
      const process = spawn(
        binary,
        [
          'tunnel',
          '--no-autoupdate',
          // Sem isso o cloudflared checa atualização e atrasa a subida.
          '--url',
          `http://127.0.0.1:${port}`,
          '--protocol',
          'http2',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      child = process;

      let settled = false;
      const finish = (hostname: string | null, detail?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (hostname) events.onStage({ stage: 'ready', hostname });
        else events.onStage({ stage: 'failed', detail: detail ?? 'túnel não subiu' });
        resolve(hostname);
      };

      const timer = setTimeout(() => {
        void stopTunnel();
        finish(null, 'túnel demorou demais para responder');
      }, timeoutMs);

      // O endereço sai no log, não em stdout estruturado. Lemos os dois.
      const read = (raw: Buffer) => {
        const match = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i.exec(raw.toString());
        if (match) finish(match[1]);
      };
      process.stdout?.on('data', read);
      process.stderr?.on('data', read);

      process.on('error', (error) => finish(null, error.message));
      process.on('exit', (code) => {
        if (child === process) child = null;
        finish(null, `cloudflared encerrou (código ${code ?? 0})`);
      });
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    events.onStage({ stage: 'failed', detail });
    return null;
  }
}

/** Derruba o túnel. Chamado ao fechar a sala e ao sair do app. */
export async function stopTunnel(): Promise<void> {
  const current = child;
  child = null;
  if (!current || current.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const done = setTimeout(() => {
      current.kill('SIGKILL');
      resolve();
    }, 3_000);
    current.once('exit', () => {
      clearTimeout(done);
      resolve();
    });
    current.kill();
  });
}

export function isTunnelRunning(): boolean {
  return child !== null && child.exitCode === null;
}
