import { useEffect, useState } from 'react';
import { Logo } from './Logo';

/**
 * Sobreposição enquanto o servidor sobe ou a conexão é feita.
 *
 * Conectar pode levar segundos — descobrir o endereço, abrir a porta, esperar
 * o host aceitar. Sem retorno visual, o clique parece não ter funcionado e a
 * pessoa clica de novo. Os passos mostram que algo está acontecendo, mesmo que
 * não sejam medições precisas.
 */
export function Connecting({ mode }: { mode: 'create' | 'join' }) {
  const steps =
    mode === 'create'
      ? ['Subindo o servidor', 'Descobrindo seu endereço', 'Preparando a sala']
      : ['Procurando o host', 'Conferindo o convite', 'Entrando na sala'];

  const [step, setStep] = useState(0);

  useEffect(() => {
    // Avança sozinho: é indicação de progresso, não medição — travar no passo 1
    // enquanto o roteador demora passaria a impressão errada.
    const timer = window.setInterval(
      () => setStep((current) => Math.min(current + 1, steps.length - 1)),
      900,
    );
    return () => window.clearInterval(timer);
  }, [steps.length]);

  return (
    <div className="scrim flex-col gap-8">
      <div className="relative">
        <div className="absolute inset-0 -z-10 animate-breathe rounded-full bg-accent/25 blur-3xl" />
        <Logo size={72} animated />
      </div>

      <div className="flex flex-col gap-2.5">
        {steps.map((label, index) => (
          <div
            key={label}
            className={`flex items-center gap-3 text-sm transition-all duration-300 ${
              index <= step ? 'text-slate-300' : 'text-slate-700'
            }`}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {index < step ? (
                <svg
                  viewBox="0 0 12 12"
                  className="h-3.5 w-3.5 text-speak"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 6.5 4.5 9 10 3.5" />
                </svg>
              ) : index === step ? (
                <span className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-ink-600 border-t-accent" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-ink-600" />
              )}
            </span>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
