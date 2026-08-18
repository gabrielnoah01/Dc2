import { useEffect, useState } from 'react';
import type { ScreenSource } from '@shared/ipc';
import { SHARE_PRESETS, type SharePresetId } from '../webrtc/quality';
import { useSettings } from '../state/settings';

interface Props {
  listSources(): Promise<ScreenSource[]>;
  onConfirm(sourceId: string, preset: SharePresetId): Promise<void>;
  onCancel(): void;
}

type Tab = 'screen' | 'window';

/**
 * Picker no estilo do Discord: abas "Telas" e "Aplicativos", grade de
 * miniaturas, seleção destacada e um botão para confirmar. As miniaturas são
 * recarregadas periodicamente para não mostrar uma janela desatualizada.
 */
export function ScreenPicker({ listSources, onConfirm, onCancel }: Props) {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [tab, setTab] = useState<Tab>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const defaultPreset = useSettings((s) => s.settings.screen.defaultPreset);
  const [preset, setPreset] = useState<SharePresetId>(defaultPreset);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const list = await listSources();
        if (!alive) return;
        setSources(list);
        setError(null);
        // Se a janela escolhida sumiu, a seleção some junto.
        setSelected((current) =>
          current && list.some((source) => source.id === current) ? current : null,
        );
      } catch {
        if (alive) setError('não foi possível listar as telas');
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [listSources]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const screens = sources?.filter((source) => source.kind === 'screen') ?? [];
  const windows = sources?.filter((source) => source.kind === 'window') ?? [];
  const visible = tab === 'screen' ? screens : windows;

  async function confirm() {
    if (!selected || starting) return;
    setStarting(true);
    try {
      await onConfirm(selected, preset);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-6"
      onClick={onCancel}
    >
      <div
        className="card flex max-h-full w-full max-w-3xl flex-col gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3">
          <h2 className="text-lg font-medium">Compartilhar tela</h2>
          <div className="ml-auto flex gap-1 rounded-md bg-ink-900 p-1 text-xs">
            <TabButton active={tab === 'screen'} onClick={() => setTab('screen')}>
              Telas ({screens.length})
            </TabButton>
            <TabButton active={tab === 'window'} onClick={() => setTab('window')}>
              Aplicativos ({windows.length})
            </TabButton>
          </div>
        </header>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {sources === null ? (
            <p className="py-8 text-center text-sm text-slate-500">Procurando…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {tab === 'screen' ? 'Nenhum monitor detectado.' : 'Nenhuma janela aberta.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {visible.map((source) => {
                const isSelected = selected === source.id;
                return (
                  <button
                    key={source.id}
                    onClick={() => setSelected(source.id)}
                    onDoubleClick={() => void confirm()}
                    className={`rounded-md p-2 text-left ring-1 transition-colors ${
                      isSelected
                        ? 'bg-ink-700 ring-2 ring-accent'
                        : 'ring-ink-600 hover:bg-ink-700 hover:ring-ink-500'
                    }`}
                  >
                    <img
                      src={source.thumbnail}
                      alt=""
                      className="mb-2 aspect-video w-full rounded bg-black object-contain"
                    />
                    <span className="flex items-center gap-2">
                      {source.appIcon && (
                        <img src={source.appIcon} alt="" className="h-4 w-4 shrink-0" />
                      )}
                      <span className="line-clamp-2 min-w-0 text-xs text-slate-300">
                        {source.name}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-ink-600 pt-3">
          <span className="text-xs uppercase tracking-wide text-slate-500">Modo</span>
          {Object.values(SHARE_PRESETS).map((option) => (
            <button
              key={option.id}
              onClick={() => setPreset(option.id)}
              title={option.description}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                preset === option.id
                  ? 'bg-accent text-white'
                  : 'bg-ink-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="text-xs text-slate-500">
            {SHARE_PRESETS[preset].description}
          </span>
        </div>

        <footer className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {tab === 'screen'
              ? 'A tela inteira, incluindo tudo o que estiver nela.'
              : 'Só a janela escolhida — o resto fica privado.'}
          </span>
          <button className="btn-ghost ml-auto" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={() => void confirm()} disabled={!selected || starting}>
            {starting ? 'Abrindo…' : 'Compartilhar'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1 transition-colors ${
        active ? 'bg-ink-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
