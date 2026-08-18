import { create } from 'zustand';
import type { ChatMessage, Participant } from '@shared/protocol';
import type { ConnectionUpdate, Role } from '@shared/ipc';

export interface ConnectionInfo {
  /** Código curto com IP público (pode faltar se a detecção falhar). */
  inviteCode: string | null;
  inviteUrl: string | null;
  /** Código para quem está na mesma rede Wi-Fi - sempre disponível. */
  localInviteCode: string;
  publicIp: string | null;
  localIp: string | null;
  port: number;
  portMapped: boolean;
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

  startHost(info: ConnectionInfo, selfId: string, participants: Participant[]): void;
  startGuest(selfId: string, participants: Participant[], screenSharerIds: string[]): void;
  endSession(reason?: string): void;
  setParticipants(participants: Participant[]): void;
  addMessage(message: ChatMessage): void;
  setScreenSharers(sharerIds: string[]): void;
  /** Dados de rede que chegaram depois da sala abrir. */
  applyConnectionUpdate(update: ConnectionUpdate): void;
  setError(error: string | null): void;
  setBusy(busy: boolean): void;
}

const EMPTY = {
  role: null as Role,
  selfId: '',
  participants: [] as Participant[],
  messages: [] as ChatMessage[],
  screenSharerIds: [] as string[],
  connection: null as ConnectionInfo | null,
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

  setScreenSharers: (screenSharerIds) => set({ screenSharerIds }),

  applyConnectionUpdate: (update) =>
    set((state) =>
      state.connection ? { connection: { ...state.connection, ...update } } : {},
    ),

  setError: (lastError) => set({ lastError }),

  setBusy: (busy) => set({ busy }),
}));

/** Helper: nome de um participante pelo id (fallback para ids já desconectados). */
export function participantName(participants: Participant[], id: string): string {
  return participants.find((p) => p.id === id)?.username ?? 'alguém';
}
