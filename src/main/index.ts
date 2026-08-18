import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers, disposeSession } from './ipc/handlers';
import { registerDisplayMediaHandler } from './screenSource';
import { checkForUpdates, registerUpdater } from './updater';
import { applySystemSettings, loadSettings } from './settings';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { createTray, destroyTray } from './tray';

// Uma segunda instância seria útil só para testes locais (host + convidado na
// mesma máquina), então em desenvolvimento não bloqueamos instâncias extras.
const isDev = process.env.NODE_ENV === 'development';

/**
 * Rede de segurança do processo principal.
 *
 * Num app comum, morrer numa exceção é aceitável. Aqui não: este processo é o
 * servidor de todo mundo que está na sala. Derrubar a conversa inteira por
 * causa de um erro isolado é sempre pior do que seguir em frente mancando.
 */
process.on('uncaughtException', (error) => {
  console.error('[only] exceção não tratada:', error);
  notifyRenderer(`erro interno contornado: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[only] promessa rejeitada sem tratamento:', reason);
});

function notifyRenderer(detail: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed()) window.webContents.send('event:error', detail);
    } catch {
      // Janela morrendo no meio do envio: nada a fazer.
    }
  }
}

app.whenReady().then(() => {
  const settings = loadSettings();
  applySystemSettings(settings);

  registerIpcHandlers();
  registerDisplayMediaHandler();
  registerUpdater();
  registerShortcuts(settings);

  const window = createMainWindow();
  if (settings.app.minimizeToTray) createTray(window);

  // Checa em segundo plano: host e convidado precisam da mesma versão do
  // protocolo, então quanto antes a atualização chegar, melhor.
  if (settings.app.checkUpdates) setTimeout(() => void checkForUpdates(), 4000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Com bandeja ligada, fechar a janela não encerra: o servidor do host precisa
  // continuar de pé enquanto a conversa existir.
  if (!loadSettings().app.minimizeToTray) app.quit();
});

// Fecha sockets e libera a porta mapeada antes de sair.
app.on('before-quit', () => {
  unregisterShortcuts();
  destroyTray();
  disposeSession();
});

if (!isDev) {
  app.setAppUserModelId('com.gabrielnoah.only');
}
