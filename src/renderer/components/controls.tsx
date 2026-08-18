import { useEffect, useState, type ReactNode } from 'react';

/** Controles reutilizados pela tela de configurações. */

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-ink-700 pb-6">
      <div>
        <h3 className="text-sm font-medium text-slate-200">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-300">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange(next: boolean): void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        value ? 'bg-accent' : 'bg-ink-500'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          value ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
}: {
  value: number;
  onChange(next: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-44 cursor-pointer appearance-none rounded-full bg-ink-500 accent-accent"
      />
      <span className="w-14 text-right text-xs tabular-nums text-slate-400">
        {value}
        {suffix}
      </span>
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(next: T): void;
}) {
  return (
    <select
      className="field w-64"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Captura uma combinação de teclas. Grava o que for pressionado no formato de
 * acelerador do Electron — digitar isso à mão é fonte garantida de erro.
 */
export function ShortcutInput({
  value,
  onChange,
}: {
  value: string;
  onChange(next: string): void;
}) {
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = async (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }

      const parts: string[] = [];
      if (event.ctrlKey) parts.push('CommandOrControl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');

      const key = normalizeKey(event);
      // Só modificador não vira atalho; espera a tecla de verdade.
      if (!key) return;
      parts.push(key);

      const accelerator = parts.join('+');
      const result = await window.only.testShortcut(accelerator);
      if (!result.ok) {
        setConflict(result.detail ?? 'combinação indisponível');
        return;
      }
      setConflict(null);
      setRecording(false);
      onChange(accelerator);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onChange]);

  return (
    <div className="flex items-center gap-2">
      {conflict && <span className="text-xs text-amber-300">{conflict}</span>}
      <button
        onClick={() => {
          setConflict(null);
          setRecording((current) => !current);
        }}
        className={`w-56 rounded-md px-3 py-2 text-xs ring-1 transition-colors ${
          recording
            ? 'bg-accent-soft text-accent ring-accent'
            : 'bg-ink-900 text-slate-300 ring-ink-500 hover:ring-ink-500'
        }`}
      >
        {recording ? 'pressione a combinação…' : value || 'nenhum atalho'}
      </button>
      {value && !recording && (
        <button
          className="text-xs text-slate-500 hover:text-slate-300"
          onClick={() => onChange('')}
          title="remover atalho"
        >
          limpar
        </button>
      )}
    </div>
  );
}

/** Converte o evento do teclado para o nome que o Electron entende. */
function normalizeKey(event: KeyboardEvent): string | null {
  const { key, code } = event;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;

  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `num${code.slice(6).toLowerCase()}`;
  if (/^F\d{1,2}$/.test(key)) return key;

  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
  };
  if (named[key]) return named[key];

  return key.length === 1 ? key.toUpperCase() : null;
}
