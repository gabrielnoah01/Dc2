import { BrowserWindow, Notification } from 'electron';
import { APP_NAME } from '../shared/constants';
import { loadSettings } from './settings';
import { revealWindow } from './window';
import type { ChatMessage } from '../shared/protocol';

/**
 * Aviso do sistema quando chega mensagem no chat.
 *
 * Mora no main de propósito: o renderer só recebe aviso quando está vivo e em
 * primeiro plano no Chromium, e é justamente com a janela escondida que a
 * notificação importa. Aqui também é onde o clique consegue trazer a janela
 * de volta.
 */
export function notifyChat(message: ChatMessage, selfId: string | null): void {
  // A própria mensagem ecoando de volta não é novidade para ninguém.
  if (selfId && message.fromId === selfId) return;

  const { notifications } = loadSettings();
  if (!notifications.desktopOnMessage) return;
  if (!Notification.isSupported()) return;

  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  const focused = window ? window.isFocused() && window.isVisible() && !window.isMinimized() : false;
  if (notifications.onlyWhenUnfocused && focused) return;

  const notification = new Notification({
    title: message.username || APP_NAME,
    body: describeBody(message, notifications.showPreview),
    silent: true, // o som já é do app, tocado pelo renderer conforme o volume.
  });

  notification.on('click', () => {
    const target = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (target) revealWindow(target);
  });

  try {
    notification.show();
  } catch (error) {
    // Sistema sem suporte real (ou sem permissão) não derruba a conversa.
    console.error('[only] não deu para mostrar o aviso do sistema:', error);
  }
}

/** Uma linha curta: prévia quando permitido e legível, senão o genérico. */
function describeBody(message: ChatMessage, showPreview: boolean): string {
  const attachment = message.attachment ? 'enviou uma imagem' : '';
  if (!showPreview) return attachment || 'mandou uma mensagem';

  const text = message.text.trim();
  if (!text) return attachment || 'mandou uma mensagem';
  const preview = text.length > 120 ? `${text.slice(0, 119)}…` : text;
  return attachment ? `${preview} (com imagem)` : preview;
}
