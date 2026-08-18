import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../shared/settings';

/**
 * Persistência das preferências, em JSON dentro de `userData`.
 *
 * Escrita é síncrona de propósito: o arquivo tem alguns KB e assim uma
 * alteração feita segundos antes de fechar o app não se perde.
 */

let cache: Settings | null = null;

function filePath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Settings {
  if (cache) return cache;
  try {
    cache = mergeSettings(JSON.parse(readFileSync(filePath(), 'utf-8')));
  } catch {
    // Arquivo ausente na primeira execução, ou corrompido: começa do padrão.
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

/**
 * Aplica um patch parcial. O renderer manda só o que mudou, então mesclamos
 * por seção para não zerar o resto.
 */
export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const current = loadSettings();
  const next: Settings = {
    audio: { ...current.audio, ...(patch.audio ?? {}) },
    chat: { ...current.chat, ...(patch.chat ?? {}) },
    shortcuts: { ...current.shortcuts, ...(patch.shortcuts ?? {}) },
    screen: { ...current.screen, ...(patch.screen ?? {}) },
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    network: { ...current.network, ...(patch.network ?? {}) },
    app: { ...current.app, ...(patch.app ?? {}) },
    // `peers` é substituído inteiro quando vem: é assim que dá para remover uma
    // pessoa da lista em vez de só sobrescrever.
    peers: patch.peers
      ? ({ ...current.peers, ...patch.peers } as Settings['peers'])
      : current.peers,
  };

  cache = next;
  persist(next);
  applySystemSettings(next);
  broadcast(next);
  return next;
}

export function resetSettings(): Settings {
  cache = { ...DEFAULT_SETTINGS };
  persist(cache);
  applySystemSettings(cache);
  broadcast(cache);
  return cache;
}

function persist(settings: Settings): void {
  try {
    mkdirSync(dirname(filePath()), { recursive: true });
    writeFileSync(filePath(), JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('[only] não deu para salvar as configurações', error);
  }
}

function broadcast(settings: Settings): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('event:settings', settings);
  }
}

/** O que depende do sistema operacional, não do renderer. */
export function applySystemSettings(settings: Settings): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.app.startWithWindows,
      // Abrir junto com o Windows sem janela pulando na cara é o comportamento
      // esperado de um app que fica de fundo.
      args: ['--hidden'],
    });
  } catch (error) {
    console.error('[only] não deu para configurar o início automático', error);
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};
