import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Rede de segurança da interface.
 *
 * Sem isto, qualquer exceção durante a renderização desmonta a árvore inteira e
 * o usuário fica olhando uma janela preta, sem pista nenhuma do que aconteceu —
 * foi exatamente assim que um campo faltando numa mensagem do host apareceu.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[only] a interface quebrou:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-medium text-red-300">Alguma coisa quebrou na tela</h1>
        <p className="max-w-lg text-sm text-slate-400">
          A conversa em si pode continuar de pé — isto foi um erro de interface. Se acontecer
          de novo, provavelmente é diferença de versão entre você e o host.
        </p>
        <pre className="max-h-48 max-w-2xl overflow-auto rounded-md bg-ink-900 p-4 text-left text-xs text-slate-400">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => window.location.reload()}>
            Recarregar
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              void window.only.leave().finally(() => window.location.reload());
            }}
          >
            Sair do servidor e recarregar
          </button>
        </div>
      </div>
    );
  }
}
