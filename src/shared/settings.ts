/**
 * Todas as preferências do usuário num contrato só, compartilhado entre main e
 * renderer. Quem persiste é o main (arquivo JSON em `userData`); o renderer só
 * lê e pede alterações.
 *
 * Regra ao adicionar campo novo: sempre com valor padrão em `DEFAULT_SETTINGS`.
 * O merge é tolerante a campo faltando, então versões antigas do arquivo
 * continuam abrindo sem quebrar.
 */

export type SharePresetId = 'fluid' | 'sharp';

/** Como o microfone decide quando transmitir. */
export type VoiceMode = 'open' | 'ptt';

export interface AudioSettings {
  /** `deviceId` do microfone; vazio = o padrão do sistema. */
  inputDeviceId: string;
  /** `deviceId` da saída; vazio = o padrão do sistema. */
  outputDeviceId: string;
  /** Ganho do microfone, 0–200 (%). */
  inputVolume: number;
  /** Volume geral de quem você ouve, 0–200 (%). */
  outputVolume: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  voiceMode: VoiceMode;
  /** Acima de quanto conta como "falando", 0–100. */
  speakingSensitivity: number;
  /** Quanto tempo o microfone segue aberto depois de soltar a tecla (ms). */
  pttReleaseDelay: number;
}

export interface ShortcutSettings {
  /** Aceleradores do Electron, ex.: `CommandOrControl+Shift+M`. Vazio = desligado. */
  toggleMute: string;
  toggleDeafen: string;
  pushToTalk: string;
  /** Atalhos funcionam com o app em segundo plano (registro global). */
  global: boolean;
}

export interface ScreenSettings {
  defaultPreset: SharePresetId;
  /** Teto de banda por tela enviada, em Mbps. */
  maxBitrateMbps: number;
  /** Inclui o cursor do mouse na captura. */
  showCursor: boolean;
}

export interface NotificationSettings {
  soundOnJoin: boolean;
  soundOnLeave: boolean;
  soundOnMessage: boolean;
  /** Volume dos avisos, 0–100. */
  volume: number;
}

/**
 * Dias de retenção. Número livre para o usuário escolher o que quiser;
 * `-1` significa "nunca apagar".
 */
export type RetentionDays = number;

/** Sugestões prontas na interface — o campo continua aceitando qualquer valor. */
export const RETENTION_PRESETS = [1, 3, 7, 14, 30, 90, 180, 365] as const;

export const NEVER_DELETE: RetentionDays = -1;

export interface ChatSettings {
  /** Guardar a conversa em disco (só o host guarda; ele é o dono da sala). */
  saveHistory: boolean;
  /** Apaga mensagens mais velhas que isto. */
  retentionDays: RetentionDays;
  /**
   * Apaga a conversa inteira depois de tanto tempo sem uso. Diferente da
   * retenção de mensagens: uma conversa que ninguém abre há meses some por
   * completo, com imagens e tudo.
   */
  conversationRetentionDays: RetentionDays;
  /** Quantas mensagens quem entra recebe de histórico. */
  historyOnJoin: number;
  /** Teto por imagem depois da compressão, em MB. */
  maxImageMb: number;
  /** Qualidade da compressão, 0–100. */
  imageQuality: number;
}

export interface NetworkSettings {
  /** Porta sugerida ao criar servidor. */
  defaultPort: number;
  /** Tentar abrir a porta sozinho no roteador. */
  useUpnp: boolean;
  /**
   * Usar STUN público para descobrir o endereço externo da mídia. Desligado,
   * voz e tela só funcionam na rede local — em compensação nenhum servidor de
   * terceiro é contatado.
   */
  useStun: boolean;
}

/** Um servidor em que já entramos, para voltar sem recolar o código. */
export interface RecentServer {
  /** Código completo, com token — é ele que faz a entrada funcionar. */
  invite: string;
  /** Como mostrar na lista: só o endereço, sem expor o token. */
  label: string;
  lastJoinedAt: number;
}

export interface AppSettings {
  /** Nome que já vem preenchido nas telas de criar/entrar. */
  username: string;
  /** Últimos servidores em que entrou, do mais recente para o mais antigo. */
  recentServers: RecentServer[];
  startWithWindows: boolean;
  /** Fechar a janela manda para a bandeja em vez de encerrar. */
  minimizeToTray: boolean;
  checkUpdates: boolean;
}

/** Ajustes que valem só para você, aplicados a uma pessoa específica. */
export interface PeerSettings {
  /** Silenciada localmente: os outros continuam ouvindo normalmente. */
  muted: boolean;
  /** Volume individual, 0–200 (%). */
  volume: number;
}

export interface Settings {
  audio: AudioSettings;
  chat: ChatSettings;
  shortcuts: ShortcutSettings;
  screen: ScreenSettings;
  notifications: NotificationSettings;
  network: NetworkSettings;
  app: AppSettings;
  /** Por nome de usuário — ids mudam a cada sessão, nomes não. */
  peers: Record<string, PeerSettings>;
}

export const DEFAULT_PEER_SETTINGS: PeerSettings = {
  muted: false,
  volume: 100,
};

export const DEFAULT_SETTINGS: Settings = {
  audio: {
    inputDeviceId: '',
    outputDeviceId: '',
    inputVolume: 100,
    outputVolume: 100,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    voiceMode: 'open',
    speakingSensitivity: 5,
    pttReleaseDelay: 300,
  },
  chat: {
    saveHistory: true,
    retentionDays: 7,
    conversationRetentionDays: 90,
    historyOnJoin: 200,
    maxImageMb: 2,
    imageQuality: 82,
  },
  shortcuts: {
    toggleMute: 'CommandOrControl+Shift+M',
    toggleDeafen: 'CommandOrControl+Shift+D',
    pushToTalk: '',
    global: true,
  },
  screen: {
    defaultPreset: 'fluid',
    maxBitrateMbps: 6,
    showCursor: true,
  },
  notifications: {
    soundOnJoin: true,
    soundOnLeave: true,
    soundOnMessage: false,
    volume: 50,
  },
  network: {
    defaultPort: 51820,
    useUpnp: true,
    useStun: true,
  },
  app: {
    username: '',
    recentServers: [],
    startWithWindows: false,
    minimizeToTray: true,
    checkUpdates: true,
  },
  peers: {},
};

/**
 * Junta o que está salvo com os padrões, campo a campo. Arquivo de versão
 * antiga (sem as chaves novas) continua válido, e chave desconhecida é ignorada.
 */
export function mergeSettings(stored: unknown): Settings {
  const source = (stored ?? {}) as Partial<Settings>;
  return {
    audio: { ...DEFAULT_SETTINGS.audio, ...(source.audio ?? {}) },
    chat: { ...DEFAULT_SETTINGS.chat, ...(source.chat ?? {}) },
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(source.shortcuts ?? {}) },
    screen: { ...DEFAULT_SETTINGS.screen, ...(source.screen ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(source.notifications ?? {}) },
    network: { ...DEFAULT_SETTINGS.network, ...(source.network ?? {}) },
    app: { ...DEFAULT_SETTINGS.app, ...(source.app ?? {}) },
    peers: { ...(source.peers ?? {}) },
  };
}

/** Ajustes de uma pessoa, já com os padrões aplicados. */
export function peerSettings(settings: Settings, username: string): PeerSettings {
  return { ...DEFAULT_PEER_SETTINGS, ...(settings.peers[username] ?? {}) };
}
