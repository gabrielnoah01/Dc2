import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';
import { useSettings } from '../state/settings';
import { useWindowActivity } from '../state/windowActivity';

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
 *
 * Toda tela também pode ser fechada individualmente. Não é só arrumação de
 * espaço: uma tela fechada não é decodificada nem pintada, e receber 1080p60 é
 * o trabalho mais caro que o app faz. Quem entrou pela conversa e não quer
 * assistir a ninguém pode zerar esse custo sem sair da sala.
 */
export function ScreenShareView({ tiles }: Props) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** Telas que a pessoa fechou de propósito. */
  const [closedIds, setClosedIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLElement | null>(null);

  const activity = useWindowActivity();
  const pauseWhenHidden = useSettings((s) => s.settings.screen.pauseVideoWhenHidden);

  // Minimizado, todo vídeo recebido para de ser decodificado. Ninguém está
  // olhando, e o que se ganha em CPU/GPU vai direto para os FPS do que a
  // pessoa estiver fazendo na frente.
  const paused = pauseWhenHidden && activity === 'hidden';

  const closed = useMemo(() => new Set(closedIds), [closedIds]);
  const open = useMemo(() => tiles.filter((tile) => !closed.has(tile.ownerId)), [tiles, closed]);
  const shut = useMemo(() => tiles.filter((tile) => closed.has(tile.ownerId)), [tiles, closed]);

  const toggleClosed = useCallback((ownerId: string) => {
    setClosedIds((current) =>
      current.includes(ownerId)
        ? current.filter((id) => id !== ownerId)
        : [...current, ownerId],
    );
  }, []);

  // Quem parou de compartilhar sai da lista de fechados: se voltar depois, a
  // tela abre de novo em vez de reaparecer misteriosamente escondida.
  useEffect(() => {
    setClosedIds((current) => {
      const alive = current.filter((id) => tiles.some((tile) => tile.ownerId === id));
      return alive.length === current.length ? current : alive;
    });
  }, [tiles]);

  // Se quem estava em destaque parou de compartilhar (ou foi fechado), volta
  // para a grade.
  useEffect(() => {
    if (focusedId && !open.some((tile) => tile.ownerId === focusedId)) {
      setFocusedId(null);
    }
  }, [open, focusedId]);

  // Uma tela só não precisa de escolha: ela já é o destaque.
  useEffect(() => {
    if (open.length === 1) setFocusedId(open[0].ownerId);
  }, [open]);

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
      if (event.key.toLowerCase() === 'f' && open.length > 0) toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen, open.length]);

  if (tiles.length === 0) return null;

  const focused = focusedId ? open.find((tile) => tile.ownerId === focusedId) : null;
  const others = focused ? open.filter((tile) => tile.ownerId !== focused.ownerId) : [];

  return (
    <section
      ref={containerRef}
      className={`relative flex min-h-0 animate-fade-in flex-col bg-ink-950 ${
        open.length > 0 ? 'flex-1' : 'shrink-0'
      }`}
    >
      {open.length > 0 &&
        (focused ? (
          <>
            <ScreenTileView
              tile={focused}
              focused
              fullscreen={fullscreen}
              paused={paused}
              onClick={() => open.length > 1 && setFocusedId(null)}
              onToggleFullscreen={toggleFullscreen}
              onClose={() => toggleClosed(focused.ownerId)}
            />
            {others.length > 0 && (
              <div className="flex shrink-0 animate-slide-down gap-2 overflow-x-auto bg-ink-900/80 p-2">
                {others.map((tile) => (
                  <div key={tile.ownerId} className="h-24 w-40 shrink-0">
                    <ScreenTileView
                      tile={tile}
                      paused={paused}
                      onClick={() => setFocusedId(tile.ownerId)}
                      onToggleFullscreen={toggleFullscreen}
                      onClose={() => toggleClosed(tile.ownerId)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className={`grid min-h-0 flex-1 gap-2 p-2 ${gridColumns(open.length)}`}>
            {open.map((tile) => (
              <ScreenTileView
                key={tile.ownerId}
                tile={tile}
                paused={paused}
                onClick={() => setFocusedId(tile.ownerId)}
                onToggleFullscreen={toggleFullscreen}
                onClose={() => toggleClosed(tile.ownerId)}
              />
            ))}
          </div>
        ))}

      {shut.length > 0 && <ClosedStrip tiles={shut} onOpen={toggleClosed} />}

      {paused && open.length > 0 && (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-ink-950/80 px-2 py-1 text-[11px] text-slate-400 backdrop-blur-sm">
          vídeo pausado — janela minimizada
        </span>
      )}
    </section>
  );
}

/**
 * As telas fechadas viram uma faixa de botões.
 *
 * Elas continuam à vista de propósito: uma tela que some por completo vira
 * "sumiu do nada" na cabeça de quem fechou, e reabrir precisa ser um clique no
 * mesmo lugar onde ela estava.
 */
function ClosedStrip({
  tiles,
  onOpen,
}: {
  tiles: ScreenTile[];
  onOpen(ownerId: string): void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-ink-800 bg-ink-900/60 px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-slate-500">
        {tiles.length === 1 ? 'tela fechada' : 'telas fechadas'}
      </span>
      {tiles.map((tile) => (
        <button
          key={tile.ownerId}
          className="flex items-center gap-1.5 rounded-md bg-ink-800/80 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-ink-700 hover:text-white"
          onClick={() => onOpen(tile.ownerId)}
          title={`Voltar a receber a tela de ${tile.label}`}
        >
          <EyeIcon />
          {tile.isLocal ? 'Sua tela' : tile.label}
        </button>
      ))}
    </div>
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
  onClose,
  paused = false,
  focused = false,
  fullscreen = false,
}: {
  tile: ScreenTile;
  onClick(): void;
  onToggleFullscreen(): void;
  onClose(): void;
  paused?: boolean;
  focused?: boolean;
  fullscreen?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Pausar não basta: com a faixa ainda ligada no elemento, o Chromium
    // continua decodificando quadro a quadro. Soltar a origem é o que
    // realmente devolve a CPU e a GPU.
    if (paused) {
      video.srcObject = null;
      setLive(false);
      return;
    }

    setLive(false);
    video.srcObject = tile.stream;
    if (tile.stream) video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [tile.stream, paused]);

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
          {paused ? (
            <p className="text-xs text-slate-500">vídeo pausado enquanto a janela está minimizada</p>
          ) : (
            <>
              <span className="h-6 w-6 animate-spin-slow rounded-full border-2 border-ink-600 border-t-accent" />
              <p className="text-xs text-slate-500">Recebendo a tela de {tile.label}…</p>
            </>
          )}
        </div>
      )}

      <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-ink-950/80 px-2 py-1 text-xs text-slate-200 backdrop-blur-sm">
        <Icon.screen size={12} className={tile.isLocal ? 'text-accent' : 'text-speak'} />
        {tile.isLocal ? 'Você está compartilhando' : tile.label}
      </span>

      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {focused && (
          <button
            className="rounded-md bg-ink-950/80 p-2 text-slate-300 backdrop-blur-sm transition-colors hover:text-white"
            onClick={onToggleFullscreen}
            title={fullscreen ? 'Sair da tela cheia (F ou Esc)' : 'Tela cheia (F)'}
          >
            {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        )}
        <button
          className="rounded-md bg-ink-950/80 p-2 text-slate-300 backdrop-blur-sm transition-colors hover:text-white"
          onClick={onClose}
          title={
            tile.isLocal
              ? 'Fechar a prévia da sua tela (você continua compartilhando)'
              : `Fechar a tela de ${tile.label} — para de decodificar e economiza CPU`
          }
        >
          <EyeOffIcon />
        </button>
      </div>
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

function EyeOffIcon() {
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
      <path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.3 3.5M6.2 6.7C3.9 8.2 3 10.4 3 12c0 2.5 4 7 9 7a9.6 9.6 0 0 0 4.3-1M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
