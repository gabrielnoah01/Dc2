import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';

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
 * Mostra todas as telas em andamento.
 *
 * Três modos, na ordem em que a pessoa costuma querer: grade quando há várias,
 * destaque ao clicar numa, e tela cheia para assistir de verdade. Acompanhar
 * duas telas pequenas lado a lado não funciona — por isso o destaque existe.
 */
export function ScreenShareView({ tiles }: Props) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  // Se quem estava em destaque parou de compartilhar, volta para a grade.
  useEffect(() => {
    if (focusedId && !tiles.some((tile) => tile.ownerId === focusedId)) {
      setFocusedId(null);
    }
  }, [tiles, focusedId]);

  // Uma tela só não precisa de escolha: ela já é o destaque.
  useEffect(() => {
    if (tiles.length === 1) setFocusedId(tiles[0].ownerId);
  }, [tiles]);

  const toggleFullscreen = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen().catch(() => undefined);
  }, []);

  // O Esc do navegador sai da tela cheia sem passar pelo nosso botão, então
  // seguimos o estado real do documento em vez de guardar o nosso.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Só quando não se está digitando, senão "f" no chat abriria tela cheia.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key.toLowerCase() === 'f' && tiles.length > 0) toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen, tiles.length]);

  if (tiles.length === 0) return null;

  const focused = focusedId ? tiles.find((tile) => tile.ownerId === focusedId) : null;
  const others = focused ? tiles.filter((tile) => tile.ownerId !== focused.ownerId) : [];

  return (
    <section
      ref={containerRef}
      className="relative flex min-h-0 flex-1 animate-fade-in flex-col bg-ink-950"
    >
      {focused ? (
        <>
          <ScreenTileView
            tile={focused}
            focused
            fullscreen={fullscreen}
            onClick={() => tiles.length > 1 && setFocusedId(null)}
            onToggleFullscreen={toggleFullscreen}
          />
          {others.length > 0 && (
            <div className="flex shrink-0 animate-slide-down gap-2 overflow-x-auto bg-ink-900/80 p-2">
              {others.map((tile) => (
                <div key={tile.ownerId} className="h-24 w-40 shrink-0">
                  <ScreenTileView
                    tile={tile}
                    onClick={() => setFocusedId(tile.ownerId)}
                    onToggleFullscreen={toggleFullscreen}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className={`grid min-h-0 flex-1 gap-2 p-2 ${gridColumns(tiles.length)}`}>
          {tiles.map((tile) => (
            <ScreenTileView
              key={tile.ownerId}
              tile={tile}
              onClick={() => setFocusedId(tile.ownerId)}
              onToggleFullscreen={toggleFullscreen}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Colunas conforme a quantidade. Três telas em duas colunas deixa uma órfã
 * ocupando metade da largura, então a partir daí vale abrir a terceira coluna.
 */
function gridColumns(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

function ScreenTileView({
  tile,
  onClick,
  onToggleFullscreen,
  focused = false,
  fullscreen = false,
}: {
  tile: ScreenTile;
  onClick(): void;
  onToggleFullscreen(): void;
  focused?: boolean;
  fullscreen?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setLive(false);
    video.srcObject = tile.stream;
    if (tile.stream) video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [tile.stream]);

  return (
    <div
      className={`group relative min-h-0 overflow-hidden bg-black ${
        focused ? 'flex-1' : 'h-full w-full rounded-lg ring-1 ring-ink-700'
      }`}
    >
      <video
        ref={videoRef}
        className={`h-full w-full object-contain transition-opacity duration-500 ${
          live ? 'opacity-100' : 'opacity-0'
        }`}
        autoPlay
        playsInline
        // O áudio da conversa vem pela conexão de voz; a tela é só vídeo.
        muted
        // O primeiro quadro pintado é o momento certo de revelar; antes disso
        // o elemento é um retângulo preto.
        onPlaying={() => setLive(true)}
      />

      {/* Camada de clique separada do vídeo, para os botões ficarem por cima. */}
      <button
        className="absolute inset-0 cursor-pointer"
        onClick={onClick}
        onDoubleClick={onToggleFullscreen}
        title={focused ? 'clique para voltar à grade · duplo clique para tela cheia' : 'clique para ampliar'}
        aria-label={`Tela de ${tile.label}`}
      />

      {!live && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="h-6 w-6 animate-spin-slow rounded-full border-2 border-ink-600 border-t-accent" />
          <p className="text-xs text-slate-500">Recebendo a tela de {tile.label}…</p>
        </div>
      )}

      <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-ink-950/80 px-2 py-1 text-xs text-slate-200 backdrop-blur-sm">
        <Icon.screen size={12} className={tile.isLocal ? 'text-accent' : 'text-speak'} />
        {tile.isLocal ? 'Você está compartilhando' : tile.label}
      </span>

      {focused && (
        <button
          className="absolute right-2 top-2 rounded-md bg-ink-950/80 p-2 text-slate-300 opacity-0 backdrop-blur-sm transition-all hover:text-white group-hover:opacity-100"
          onClick={onToggleFullscreen}
          title={fullscreen ? 'Sair da tela cheia (F ou Esc)' : 'Tela cheia (F)'}
        >
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>
      )}
    </div>
  );
}

function FullscreenIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M21 16h-3a2 2 0 0 0-2 2v3M3 16h3a2 2 0 0 1 2 2v3" />
    </svg>
  );
}
