import { useEffect, useRef, useState } from 'react';

export interface ScreenTile {
  ownerId: string;
  label: string;
  stream: MediaStream | null;
  isLocal: boolean;
}

interface Props {
  tiles: ScreenTile[];
}

/**
 * Mostra todas as telas em andamento. Com mais de uma, vira grade; clicar em
 * uma coloca ela em destaque e joga as outras numa faixa lateral — o mesmo
 * gesto que o Discord usa, porque acompanhar duas telas pequenas não funciona.
 */
export function ScreenShareView({ tiles }: Props) {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Se quem estava em destaque parou de compartilhar, volta para a grade.
  useEffect(() => {
    if (focusedId && !tiles.some((tile) => tile.ownerId === focusedId)) {
      setFocusedId(null);
    }
  }, [tiles, focusedId]);

  if (tiles.length === 0) return null;

  const focused = focusedId ? tiles.find((tile) => tile.ownerId === focusedId) : null;
  const others = focused ? tiles.filter((tile) => tile.ownerId !== focused.ownerId) : [];

  if (focused) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-black">
        <ScreenTileView tile={focused} onClick={() => setFocusedId(null)} focused />
        {others.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto bg-ink-900 p-2">
            {others.map((tile) => (
              <div key={tile.ownerId} className="h-24 w-40 shrink-0">
                <ScreenTileView tile={tile} onClick={() => setFocusedId(tile.ownerId)} />
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className={`grid min-h-0 flex-1 gap-2 bg-ink-900 p-2 ${
        tiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
      }`}
    >
      {tiles.map((tile) => (
        <ScreenTileView
          key={tile.ownerId}
          tile={tile}
          onClick={() => setFocusedId(tile.ownerId)}
        />
      ))}
    </section>
  );
}

function ScreenTileView({
  tile,
  onClick,
  focused = false,
}: {
  tile: ScreenTile;
  onClick(): void;
  focused?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = tile.stream;
    if (tile.stream) video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [tile.stream]);

  return (
    <button
      onClick={onClick}
      title={focused ? 'clique para voltar à grade' : 'clique para ampliar'}
      className={`group relative min-h-0 overflow-hidden bg-black ${
        focused ? 'flex-1' : 'h-full w-full rounded-md ring-1 ring-ink-600 hover:ring-accent'
      }`}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        autoPlay
        playsInline
        // O áudio da conversa vem pela conexão de voz; a tela é só vídeo.
        muted
      />
      {!tile.stream && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          Recebendo a tela de {tile.label}…
        </p>
      )}
      <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-slate-200">
        {tile.isLocal ? 'Você está compartilhando' : tile.label}
      </span>
    </button>
  );
}
