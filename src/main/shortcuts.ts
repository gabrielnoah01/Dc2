import { BrowserWindow, globalShortcut } from 'electron';
import { loadSettings } from './settings';
import type { Settings } from '../shared/settings';

/**
 * Atalhos globais: mutar, ensurdecer e push-to-talk mesmo com o app atrás de
 * um jogo. É todo o motivo de existirem — atalho que só funciona com a janela
 * em foco não serve para nada durante uma partida.
 *
 * O Electron não expõe "tecla solta" para atalho global, então o push-to-talk
 * usa um truque: cada repetição do atalho (o Windows repete enquanto a tecla
 * fica pressionada) empurra um temporizador para frente. Quando as repetições
 * param, o temporizador dispara e o microfone fecha.
 */

export type ShortcutAction = 'toggle-mute' | 'toggle-deafen' | 'ptt-down' | 'ptt-up';

let pttTimer: NodeJS.Timeout | null = null;
let pttActive = false;

function emit(action: ShortcutAction): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('event:shortcut', action);
  }
}

export function registerShortcuts(settings: Settings = loadSettings()): string[] {
  unregisterShortcuts();

  const failed: string[] = [];
  if (!settings.shortcuts.global) return failed;

  const bind = (accelerator: string, handler: () => void) => {
    if (!accelerator) return;
    try {
      // `register` devolve false quando outro app já tomou a combinação.
      if (!globalShortcut.register(accelerator, handler)) failed.push(accelerator);
    } catch {
      failed.push(accelerator);
    }
  };

  bind(settings.shortcuts.toggleMute, () => emit('toggle-mute'));
  bind(settings.shortcuts.toggleDeafen, () => emit('toggle-deafen'));

  bind(settings.shortcuts.pushToTalk, () => {
    if (!pttActive) {
      pttActive = true;
      emit('ptt-down');
    }
    if (pttTimer) clearTimeout(pttTimer);
    pttTimer = setTimeout(() => {
      pttActive = false;
      pttTimer = null;
      emit('ptt-up');
    }, Math.max(150, settings.audio.pttReleaseDelay));
  });

  return failed;
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
  if (pttTimer) clearTimeout(pttTimer);
  pttTimer = null;
  pttActive = false;
}
