import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers, disposeSession } from './ipc/handlers';
import { registerDisplayMediaHandler } from './screenSource';
import { checkForUpdates, registerUpdater } from './updater';
import { applySystemSettings, loadSettings } from './settings';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { createTray, destroyTray } from './tray';
import { logToFile, step } from './log';

// Uma segunda instância seria útil só para testes locais (host + convidado na
// mesma máquina), então em desenvolvimento não bloqueamos instâncias extras.
const isDev = process.env.NODE_ENV === 'development';

/** Só é seguro esconder a janela se existe um ícone para trazê-la de volta. */
let trayActive = false;

/**
 * Rede de segurança do processo principal.
 *
 * Num app comum, morrer numa exceção é aceitável. Aqui não: este processo é o
 * servidor de todo mundo que está na sala. Derrubar a conversa inteira por
 * causa de um erro isolado é sempre pior do que seguir em frente mancando.
 */
process.on('uncaughtException', (error) => {
  logToFile('erro', `exceção não tratada: ${error.stack ?? error.message}`);
  notifyRenderer(`erro interno contornado: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
  logToFile('erro', `promessa rejeitada: ${reason instanceof Error ? reason.stack : String(reason)}`);
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

/**
 * Só uma instância. Sem isto, abrir o app de novo quando ele já está escondido
 * na bandeja cria um segundo processo que também não aparece — e o usuário
 * acumula cópias invisíveis rodando de fundo.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

app.whenReady().then(() => {
  logToFile('boot', `iniciando — empacotado: ${app.isPackaged}`);

  const settings = loadSettings();
  step('preferências do sistema', () => applySystemSettings(settings));

  // Cada etapa isolada: uma falhando não pode impedir a janela de abrir, que é
  // o que transformava um erro qualquer em "app invisível rodando de fundo".
  step('canais IPC', () => registerIpcHandlers());
  step('captura de tela', () => registerDisplayMediaHandler());
  step('atualizador', () => registerUpdater());
  step('atalhos globais', () => registerShortcuts(settings));

  const window = step('janela', () => createMainWindow());
  if (!window) {
    logToFile('boot', 'sem janela — encerrando em vez de virar processo fantasma');
    app.quit();
    return;
  }

  // A bandeja pode falhar (ícone ausente). Nesse caso o "fechar esconde" fica
  // desligado: melhor encerrar de verdade do que sumir sem volta.
  const hasTray =
    settings.app.minimizeToTray && step('bandeja', () => createTray(window)) === true;
  trayActive = hasTray;
  if (settings.app.minimizeToTray && !hasTray) {
    logToFile('boot', 'bandeja indisponível — fechar a janela vai encerrar o app');
  }

  // Checa em segundo plano: host e convidado precisam da mesma versão do
  // protocolo, então quanto antes a atualização chegar, melhor.
  if (settings.app.checkUpdates) setTimeout(() => void checkForUpdates(), 4000);
  logToFile('boot', 'pronto');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Com a bandeja de pé, fechar a janela não encerra: o servidor do host
  // precisa continuar existindo enquanto a conversa durar.
  if (!trayActive) app.quit();
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
