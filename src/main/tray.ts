import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import { APP_NAME } from '../shared/constants';
import { logToFile } from './log';

/**
 * Ícone na bandeja.
 *
 * Faz diferença real aqui: o servidor só existe enquanto o app do host está
 * aberto. Sem bandeja, fechar a janela sem querer derruba a conversa de todo
 * mundo — com ela, o app continua rodando fora do caminho.
 *
 * Mas a bandeja também é perigosa: se o ícone não carregar, o app some sem
 * deixar como voltar. Por isso `createTray` devolve se conseguiu, e quem chama
 * só ativa o "fechar esconde" quando há mesmo um ícone clicável.
 */

let tray: Tray | null = null;
let warnedAboutHiding = false;

/** O ícone vive fora do asar; dentro dele o Tray não consegue carregar. */
function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../build/icon.ico');
}

export function createTray(window: BrowserWindow): boolean {
  if (tray) return true;

  const icon = nativeImage.createFromPath(iconPath());
  if (icon.isEmpty()) {
    // Sem ícone visível, mandar a janela para a bandeja seria esconder o app
    // num lugar de onde o usuário não tem como tirá-lo.
    logToFile('bandeja', `ícone não carregou de ${iconPath()} — bandeja desativada`);
    return false;
  }

  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);

  const show = () => {
    if (window.isMinimized()) window.restore();
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

  tray.on('click', show);
  tray.on('double-click', show);

  window.on('close', (event) => {
    if (!tray || (app as { isQuitting?: boolean }).isQuitting) return;
    event.preventDefault();
    window.hide();

    // Na primeira vez, avisa para onde o app foi — senão parece que fechou.
    if (!warnedAboutHiding) {
      warnedAboutHiding = true;
      tray.displayBalloon({
        icon: nativeImage.createFromPath(iconPath()),
        title: `${APP_NAME} continua aberto`,
        content:
          'A conversa segue de pé. Clique aqui na bandeja para voltar, ou use Sair para encerrar de vez.',
      });
    }
  });

  return true;
}

export function destroyTray(): void {
  (app as { isQuitting?: boolean }).isQuitting = true;
  tray?.destroy();
  tray = null;
}
