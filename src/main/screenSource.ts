import { desktopCapturer, session as electronSession } from 'electron';
import type { ScreenSource } from '../shared/ipc';

/**
 * Ponte entre o picker da UI e o `getDisplayMedia()` do renderer.
 *
 * O Chromium do Electron não expõe mais o caminho legado
 * `chromeMediaSource: 'desktop'` no `getUserMedia` (é ele que devolve
 * "Could not start video source"). O jeito suportado é o renderer chamar
 * `getDisplayMedia()` e o main responder qual fonte usar — que é exatamente o
 * que a UI escolheu no picker.
 */
let pendingSourceId: string | null = null;

export function selectScreenSource(sourceId: string): boolean {
  pendingSourceId = sourceId;
  return true;
}

export async function listScreenSources(): Promise<ScreenSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 384, height: 216 },
    fetchWindowIcons: true,
  });

  return sources
    .filter((source) => !source.thumbnail.isEmpty())
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      kind: source.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }));
}

/** Instala o handler na sessão da janela — precisa rodar antes do primeiro share. */
export function registerDisplayMediaHandler(): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const chosen = sources.find((source) => source.id === pendingSourceId);
          pendingSourceId = null;
          if (!chosen) {
            // Sem fonte armada, negar é melhor do que compartilhar algo aleatório.
            callback({ video: undefined });
            return;
          }
          callback({ video: chosen });
        })
        .catch(() => callback({ video: undefined }));
    },
    { useSystemPicker: false },
  );
}
