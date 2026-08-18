import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import { APP_NAME } from '../shared/constants';

/**
 * Ícone na bandeja.
 *
 * Faz diferença real aqui: o servidor só existe enquanto o app do host está
 * aberto. Sem bandeja, fechar a janela sem querer derruba a conversa de todo
 * mundo — com ela, o app continua rodando fora do caminho.
 */

let tray: Tray | null = null;

export function createTray(window: BrowserWindow): void {
  if (tray) return;

  const icon = nativeImage.createFromPath(join(__dirname, '../../build/icon.ico'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(APP_NAME);

  const show = () => {
    window.show();
    window.focus();
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir ${APP_NAME}`, click: show },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          // `app.quit()` sozinho esbarra no handler de "fechar vai pra bandeja".
          destroyTray();
          app.quit();
        },
      },
    ]),
  );

  tray.on('double-click', show);

  window.on('close', (event) => {
    // Só esconde se o app não estiver realmente encerrando.
    if (tray && !(app as { isQuitting?: boolean }).isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

export function destroyTray(): void {
  (app as { isQuitting?: boolean }).isQuitting = true;
  tray?.destroy();
  tray = null;
}
