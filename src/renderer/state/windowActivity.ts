import { useEffect, useState } from 'react';
import type { WindowActivityState } from '@shared/ipc';

/**
 * Último estado anunciado pelo processo principal.
 *
 * Guardado fora do React de propósito. O main só avisa quando o estado *muda*,
 * então quem monta depois — a tela de compartilhamento aparece quando alguém
 * começa a transmitir, e isso pode ser bem depois de a janela ter sumido —
 * não receberia nada e ficaria achando que está na frente, justamente no caso
 * que o recurso existe para resolver.
 */
let current: WindowActivityState = 'active';

const listeners = new Set<(activity: WindowActivityState) => void>();

/**
 * Uma assinatura só, montada no carregamento do módulo, mantém o valor acima
 * em dia. As telas que aparecem depois leem daqui já sabendo a verdade.
 */
window.only.onWindowActivity((activity) => {
  current = activity;
  for (const listener of listeners) listener(activity);
});

/**
 * O estado da janela, contado pelo processo principal.
 *
 * Serve para o app parar de fazer trabalho que ninguém está vendo — em
 * especial decodificar e pintar tela compartilhada, que é de longe o item mais
 * caro que o Only mantém rodando. Com uma tela 1080p60 em andamento, a
 * diferença entre pintar e não pintar aparece direto nos FPS de quem está
 * jogando com o app minimizado atrás.
 */
export function useWindowActivity(): WindowActivityState {
  const [activity, setActivity] = useState<WindowActivityState>(current);

  useEffect(() => {
    // O estado pode ter mudado entre a primeira renderização e agora.
    setActivity(current);
    listeners.add(setActivity);
    return () => void listeners.delete(setActivity);
  }, []);

  return activity;
}
