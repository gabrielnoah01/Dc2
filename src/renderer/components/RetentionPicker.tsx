import { useState } from 'react';
import { NEVER_DELETE, RETENTION_PRESETS, type RetentionDays } from '@shared/settings';
import { Dropdown } from './Dropdown';

/**
 * Escolha de prazo de retenção.
 *
 * Os prazos comuns ficam a um clique, mas quem quiser 45 dias não precisa se
 * conformar com 30 ou 90 — a opção "Personalizado" abre um campo livre.
 */
export function RetentionPicker({
  value,
  onChange,
  neverLabel = 'Nunca apagar',
}: {
  value: RetentionDays;
  onChange(next: RetentionDays): void;
  neverLabel?: string;
}) {
  const isPreset = value === NEVER_DELETE || RETENTION_PRESETS.includes(value as never);
  const [custom, setCustom] = useState(!isPreset);

  if (custom) {
    return (
      <div className="flex items-center gap-2">
        <input
          className="field w-24 text-right"
          inputMode="numeric"
          value={value === NEVER_DELETE ? '' : String(value)}
          onChange={(event) => {
            const days = Number(event.target.value.replace(/[^0-9]/g, '').slice(0, 5));
            // Zero apagaria tudo na hora; o mínimo útil é um dia.
            if (days > 0) onChange(days);
          }}
        />
        <span className="text-xs text-slate-500">dias</span>
        <button
          className="text-xs text-slate-500 transition-colors hover:text-slate-300"
          onClick={() => {
            setCustom(false);
            if (!isPreset) onChange(7);
          }}
        >
          usar sugestão
        </button>
      </div>
    );
  }

  return (
    <Dropdown
      value={String(value)}
      onChange={(next) => {
        if (next === 'custom') {
          setCustom(true);
          return;
        }
        onChange(Number(next));
      }}
      options={[
        ...RETENTION_PRESETS.map((days) => ({
          value: String(days),
          label: describe(days),
        })),
        { value: String(NEVER_DELETE), label: neverLabel },
        { value: 'custom', label: 'Personalizado…', hint: 'escolher o número de dias' },
      ]}
    />
  );
}

function describe(days: number): string {
  if (days === 1) return 'Depois de 1 dia';
  if (days === 7) return 'Depois de 1 semana';
  if (days === 14) return 'Depois de 2 semanas';
  if (days === 30) return 'Depois de 1 mês';
  if (days === 90) return 'Depois de 3 meses';
  if (days === 180) return 'Depois de 6 meses';
  if (days === 365) return 'Depois de 1 ano';
  return `Depois de ${days} dias`;
}
