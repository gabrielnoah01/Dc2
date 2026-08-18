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
