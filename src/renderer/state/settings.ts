import { create } from 'zustand';
import type { SettingsPatch } from '@shared/ipc';
import {
  DEFAULT_SETTINGS,
  peerSettings,
  type PeerSettings,
  type Settings,
} from '@shared/settings';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  /** Tela de configurações aberta por cima de tudo. */
  open: boolean;
  setOpen(open: boolean): void;
  /** Ecoa o que o main mandou, sem regravar. */
  receive(settings: Settings): void;
  /** Salva um patch (o main persiste e devolve o estado completo). */
  save(patch: SettingsPatch): Promise<void>;
  reset(): Promise<void>;
  /** Ajustes locais de uma pessoa, já com padrões aplicados. */
  forPeer(username: string): PeerSettings;
  setPeer(username: string, patch: Partial<PeerSettings>): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  open: false,

  setOpen: (open) => set({ open }),

  receive: (settings) => set({ settings, loaded: true }),

  save: async (patch) => {
    // Aplica na hora para a interface não dar aquele atraso de meio segundo;
    // o main confirma logo em seguida pelo evento.
    set((state) => ({
      settings: {
        ...state.settings,
        ...Object.fromEntries(
          Object.entries(patch).map(([key, value]) => [
            key,
            { ...(state.settings[key as keyof Settings] as object), ...(value as object) },
          ]),
        ),
      } as Settings,
    }));
    const saved = await window.only.updateSettings(patch);
    set({ settings: saved, loaded: true });
  },

  reset: async () => {
    const saved = await window.only.resetSettings();
    set({ settings: saved, loaded: true });
  },

  forPeer: (username) => peerSettings(get().settings, username),

  setPeer: async (username, patch) => {
    const current = peerSettings(get().settings, username);
    await get().save({ peers: { [username]: { ...current, ...patch } } });
  },
}));

/** Carrega uma vez e passa a seguir o main. */
export async function initSettings(): Promise<void> {
  const settings = await window.only.getSettings();
  useSettings.getState().receive(settings);
}
