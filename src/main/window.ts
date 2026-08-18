import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { APP_NAME } from '../shared/constants';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Traz a janela para a frente de verdade.
 *
 * O Windows recusa o foco pedido por um processo que está em segundo plano —
 * `show()` sozinho pode só piscar o botão na barra de tarefas. A sequência
 * abaixo (restaurar, mostrar, subir ao topo por um instante, focar) é o que
 * funciona de forma consistente quando o app volta da bandeja ou quando alguém
 * abre o executável de novo.
 */
export function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;

  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();

  // O pulo de "sempre no topo" força o gerenciador de janelas a promover a
  // nossa; sem isso o pedido de foco costuma ser ignorado.
  window.setAlwaysOnTop(true);
  window.setAlwaysOnTop(false);
  window.moveTop();
  window.focus();
  app.focus({ steal: true });
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#08090d',
    show: false,
    autoHideMenuBar: true,
    // Esconde a barra do Windows mas mantém minimizar/maximizar/fechar nativos,
    // desenhados na cor do app em vez do cinza padrão do sistema.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0e13',
      symbolColor: '#94a3b8',
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Links externos abrem no navegador, nunca dentro do app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    window.loadURL('http://localhost:5173');
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}
