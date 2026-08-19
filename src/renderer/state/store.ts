import { create } from 'zustand';
import type { ChatMessage, Participant } from '@shared/protocol';
import type { JoinRequest } from '@shared/ipc';
import type { ConnectionUpdate, PortStatus, ReconnectStatus, Role } from '@shared/ipc';

export interface ConnectionInfo {
  /** Código curto com IP público (pode faltar se a detecção falhar). */
  inviteCode: string | null;
  inviteUrl: string | null;
  /** Código para quem está na mesma rede Wi-Fi - sempre disponível. */
  localInviteCode: string;
  publicIp: string | null;
  localIp: string | null;
  port: number;
  portStatus: PortStatus;
  portMappingDetail?: string;
  behindCarrierNat?: boolean;
}

interface SessionState {
  role: Role;
  selfId: string;
  participants: Participant[];
  messages: ChatMessage[];
  /** Quem está compartilhando a tela agora (vazio = ninguém). */
  screenSharerIds: string[];
  connection: ConnectionInfo | null;
  /** Erro fatal que derrubou a sessão; mostrado na HomeScreen. */
  lastError: string | null;
  busy: boolean;
  /**
   * Andamento da volta automática. Enquanto não desistir, a tela da sala
   * continua montada - o histórico e a lista de gente seguem valendo.
   */
  reconnect: ReconnectStatus;
  /** Quem bateu na porta e ainda espera o host decidir (só o host vê). */
  joinRequests: JoinRequest[];
  /** Convidado esperando o host abrir a porta (aprovação manual). */
  joinPending: string | null;
  startHost(info: ConnectionInfo, selfId: string, participants: Participant[]): void;
  startGuest(selfId: string, participants: Participant[], screenSharerIds: string[]): void;
  endSession(reason?: string): void;
  setParticipants(participants: Participant[]): void;
  addMessage(message: ChatMessage): void;
  /** Substitui o histórico (chega logo depois de entrar na sala). */
  setHistory(messages: ChatMessage[]): void;
  /** Preenche a imagem de uma mensagem que veio só com o descritor. */
  setAttachmentData(messageId: string, dataUrl: string | null): void;
  setScreenSharers(sharerIds: string[]): void;
  /** Dados de rede que chegaram depois da sala abrir. */
  applyConnectionUpdate(update: ConnectionUpdate): void;
  setError(error: string | null): void;
  setBusy(busy: boolean): void;
  /** Traduz o andamento da volta em estado de tela. */
  applyReconnect(status: ReconnectStatus): void;
  setJoinRequests(requests: JoinRequest[]): void;
  setJoinPending(reason: string | null): void;
}

const EMPTY = {
  role: null as Role,
  selfId: '',
  participants: [] as Participant[],
  messages: [] as ChatMessage[],
  screenSharerIds: [] as string[],
  connection: null as ConnectionInfo | null,
  reconnect: { state: 'idle' } as ReconnectStatus,
  joinRequests: [] as JoinRequest[],
  joinPending: null as string | null,
};

export const useSession = create<SessionState>((set) => ({
  ...EMPTY,
  lastError: null,
  busy: false,

  startHost: (connection, selfId, participants) =>
    set({
      ...EMPTY,
      role: 'host',
      selfId,
      participants,
      connection,
      lastError: null,
      busy: false,
    }),

  startGuest: (selfId, participants, screenSharerIds) =>
    set({
      ...EMPTY,
      role: 'guest',
      selfId,
      participants,
      screenSharerIds,
      lastError: null,
      busy: false,
    }),

  endSession: (reason) => set({ ...EMPTY, lastError: reason ?? null, busy: false }),

  setParticipants: (participants) => set({ participants }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message].slice(-500) })),

  setHistory: (messages) =>
    set((state) => {
      // O histórico pode chegar depois de já ter conversa na tela; junta sem
      // duplicar e mantém a ordem cronológica.
      const known = new Set(state.messages.map((message) => message.id));
      const merged = [...messages.filter((message) => !known.has(message.id)), ...state.messages];
      return { messages: merged.sort((a, b) => a.ts - b.ts).slice(-500) };
    }),

  setAttachmentData: (messageId, dataUrl) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId && message.attachment
          ? { ...message, attachment: { ...message.attachment, dataUrl: dataUrl ?? undefined } }
          : message,
      ),
    })),

  setScreenSharers: (screenSharerIds) => set({ screenSharerIds }),

  applyConnectionUpdate: (update) =>
    set((state) =>
      state.connection ? { connection: { ...state.connection, ...update } } : {},
    ),

  setError: (lastError) => set({ lastError }),

  setBusy: (busy) => set({ busy }),

  applyReconnect: (status) =>
    set((state) => {
      if (status.state === 'reconnected') {
        // A sala voltou: troca só a identidade e quem está lá. Mensagens
        // continuam onde estavam - a conversa não pisca.
        return {
          reconnect: status,
          role: status.role,
          selfId: status.selfId,
          participants: status.participants,
          screenSharerIds: status.screenSharerIds,
          lastError: null,
        };
      }
      if (status.state === 'failed') {
        // Desistimos de verdade: aí sim volta para a tela inicial.
        return { ...EMPTY, lastError: status.reason || null, busy: false };
      }
      // 'retrying' e 'connecting' mantêm a sala de pé.
      return state.role ? { reconnect: status } : {};
    }),

  setJoinRequests: (joinRequests) => set({ joinRequests }),

  setJoinPending: (joinPending) => set({ joinPending }),
}));

/** Helper: nome de um participante pelo id (fallback para ids já desconectados). */
export function participantName(participants: Participant[], id: string): string {
  return participants.find((p) => p.id === id)?.username ?? 'alguém';
}
