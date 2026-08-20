import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { APP_NAME } from '../shared/constants';
import { IPC_EVENT, type WindowActivityState } from '../shared/ipc';

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

  reportActivity(window);

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

/**
 * Conta ao renderer quando a janela sai e volta da frente.
 *
 * Sem isso o renderer só teria `document.visibilityState`, que trata
 * "minimizada" e "atrás de outra janela" como o mesmo estado — e é justamente
 * a diferença entre poder desligar o vídeo inteiro e só aliviar a mão.
 *
 * `setBackgroundThrottling(false)` anda junto de propósito: com o
 * estrangulamento padrão do Chromium, os temporizadores do renderer caem para
 * um por segundo quando a janela some, o que atrasava sinalização de WebRTC e
 * batimento de rede e deixava a sala inconsistente depois de um tempo
 * minimizada. Agora quem decide o que parar é este arquivo, explicitamente,
 * em vez do navegador cortando o que der na telha.
 */
function reportActivity(window: BrowserWindow): void {
  window.webContents.setBackgroundThrottling(false);

  let last: WindowActivityState | null = null;

  const publish = (): void => {
    if (window.isDestroyed()) return;

    const activity: WindowActivityState =
      window.isMinimized() || !window.isVisible()
        ? 'hidden'
        : window.isFocused()
          ? 'active'
          : 'background';

    if (activity === last) return;
    last = activity;
    try {
      window.webContents.send(IPC_EVENT.windowActivity, activity);
    } catch {
      // Janela morrendo no meio do envio: nada a fazer.
    }
  };

  // Um a um em vez de um laço: a tipagem de `BrowserWindow.on` é por evento,
  // e uma união de nomes não casa com nenhuma das sobrecargas.
  window.on('minimize', publish);
  window.on('restore', publish);
  window.on('maximize', publish);
  window.on('unmaximize', publish);
  window.on('show', publish);
  window.on('hide', publish);
  window.on('focus', publish);
  window.on('blur', publish);

  // Renderer recarregado começa sem saber de nada, e o `last` guardado aqui
  // engoliria o reenvio por parecer repetido.
  window.webContents.on('did-finish-load', () => {
    last = null;
    publish();
  });
  window.webContents.on('render-process-gone', () => {
    last = null;
  });
}
