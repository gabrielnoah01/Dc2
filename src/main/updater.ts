import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/ipc';

/**
 * Atualização automática.
 *
 * Existe por um motivo concreto: host e convidado precisam falar a mesma versão
 * do protocolo. Sem isso, cada mudança de formato de mensagem vira "não consigo
 * entrar" para quem não atualizou na mão.
 *
 * Só funciona na versão instalada (NSIS). O executável portátil não tem como se
 * substituir enquanto roda, então lá a checagem vira só um aviso.
 */

let current: UpdateStatus = { state: 'idle' };
let checking = false;

function publish(status: UpdateStatus): void {
  current = status;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('event:update', status);
  }
}

export function getUpdateStatus(): UpdateStatus {
  return current;
}

export function registerUpdater(): void {
  // Baixar sozinho e instalar só quando o usuário mandar: ninguém quer o app
  // reiniciando no meio de uma conversa.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    publish({ state: 'downloading', version: info.version, percent: 0 });
  });

  autoUpdater.on('update-not-available', () => publish({ state: 'idle' }));

  autoUpdater.on('download-progress', (progress) => {
    publish({
      state: 'downloading',
      version: current.version,
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    publish({ state: 'ready', version: info.version });
  });

  autoUpdater.on('error', (error) => {
    // Sem servidor de atualização configurado isso dispara sempre; não vale
    // encher a tela do usuário com erro que não é problema dele.
    publish({ state: 'unavailable', detail: error.message });
  });
}

/** Checagem manual (botão) ou automática (ao abrir). */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (checking) return current;
  if (!app.isPackaged) {
    publish({ state: 'unavailable', detail: 'atualização só funciona no app instalado' });
    return current;
  }

  checking = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({
      state: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    checking = false;
  }
  return current;
}

/** Fecha e instala. Só faz sentido quando o download terminou. */
export function installUpdate(): void {
  if (current.state !== 'ready') return;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}
