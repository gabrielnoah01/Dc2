import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange(next: T): void;
  className?: string;
  placeholder?: string;
}

/**
 * Substitui o `<select>` nativo, que no Windows abre uma lista do sistema
 * impossível de estilizar — fundo branco no meio de um app escuro.
 *
 * A lista vai num portal preso ao `body`: dentro de um painel com `overflow`
 * ela seria cortada pela borda do container.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  className = 'w-64',
  placeholder = 'selecione',
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setHighlight(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (
        !listRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return setOpen(false);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => {
          const next = current + (event.key === 'ArrowDown' ? 1 : -1);
          return (next + options.length) % options.length;
        });
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const option = options[highlight];
        if (option) {
          onChange(option.value);
          setOpen(false);
        }
      }
    };

    /**
     * Rolar a página move o botão, então a lista precisa acompanhar. Mas rolar
     * *dentro* da lista não pode mexer em nada — era o que fechava o dropdown
     * assim que a pessoa tentava percorrer as opções.
     */
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    };
    const onResize = () => setRect(buttonRef.current?.getBoundingClientRect() ?? null);

    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, options, highlight, onChange]);

  // Abre para cima quando não há espaço embaixo.
  const listHeight = Math.min(options.length * 40 + 8, 280);
  const openUp = rect ? rect.bottom + listHeight > window.innerHeight - 8 : false;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((current) => !current)}
        className={`field flex items-center gap-2 text-left ${className} ${
          open ? 'ring-2 ring-accent' : ''
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-slate-600'}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          viewBox="0 0 12 12"
          className={`h-3 w-3 shrink-0 text-slate-500 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            className="fixed z-50 animate-slide-down overflow-y-auto rounded-lg bg-ink-800 p-1 shadow-pop ring-1 ring-ink-500"
            style={{
              left: rect.left,
              width: rect.width,
              maxHeight: listHeight,
              ...(openUp
                ? { bottom: window.innerHeight - rect.top + 6 }
                : { top: rect.bottom + 6 }),
            }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    // Rolar até a opção destacada quando se navega pelas setas.
                    if (index === highlight) node?.scrollIntoView({ block: 'nearest' });
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    index === highlight ? 'bg-ink-600 text-white' : 'text-slate-300'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.hint && (
                      <span className="block truncate text-[11px] text-slate-500">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <svg
                      viewBox="0 0 12 12"
                      className="h-3 w-3 shrink-0 text-accent"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 6.5 4.5 9 10 3.5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
