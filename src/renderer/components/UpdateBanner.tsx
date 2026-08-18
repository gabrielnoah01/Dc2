import type { UpdateStatus } from '@shared/ipc';

/**
 * Faixa de atualização. Só aparece quando há algo acontecendo — "nenhuma
 * atualização" e "sem servidor de atualização configurado" ficam invisíveis,
 * porque não são problema do usuário.
 */
export function UpdateBanner({ status }: { status: UpdateStatus }) {
  if (status.state === 'idle' || status.state === 'checking' || status.state === 'unavailable') {
    return null;
  }

  if (status.state === 'downloading') {
    return (
      <div className="flex items-center gap-3 bg-ink-700 px-4 py-1.5 text-xs text-slate-300">
        <span>
          Baixando atualização{status.version ? ` ${status.version}` : ''}… {status.percent}%
        </span>
        <div className="h-1 w-40 overflow-hidden rounded-full bg-ink-900">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-accent/20 px-4 py-1.5 text-xs text-slate-100">
      <span>
        Versão {status.version} pronta. Atualize os dois lados: host e convidado precisam da
        mesma versão para conversar.
      </span>
      <button
        className="btn-primary ml-auto px-3 py-1 text-xs"
        onClick={() => void window.only.installUpdate()}
      >
        Reiniciar e atualizar
      </button>
    </div>
  );
}
