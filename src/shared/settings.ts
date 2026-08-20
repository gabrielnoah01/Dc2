/**
 * Todas as preferências do usuário num contrato só, compartilhado entre main e
 * renderer. Quem persiste é o main (arquivo JSON em `userData`); o renderer só
 * lê e pede alterações.
 *
 * Regra ao adicionar campo novo: sempre com valor padrão em `DEFAULT_SETTINGS`.
 * O merge é tolerante a campo faltando, então versões antigas do arquivo
 * continuam abrindo sem quebrar.
 */
import { MAX_ICE_SERVERS } from './constants';

export type SharePresetId = 'fluid' | 'sharp';

/** Como o microfone decide quando transmitir. */
export type VoiceMode = 'open' | 'ptt';

/**
 * Força da supressão de ruído, em camadas.
 *
 * Supressão é sempre uma troca: o que corta ventilador e teclado também come o
 * começo das palavras e a respiração que faz a voz soar humana. Por isso são
 * níveis e não um interruptor — quem tem sala silenciosa fica no leve, quem
 * mora em rua movimentada sobe até o máximo, e quem achar que ficou robótico
 * desce um degrau.
 */
export type NoiseSuppressionLevel = 'off' | 'light' | 'medium' | 'max';

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
  /** Força da supressão de ruído do microfone. */
  noiseSuppressionLevel: NoiseSuppressionLevel;
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
  /**
   * Com a janela minimizada, para de decodificar e pintar as telas recebidas.
   * É de longe a maior economia de CPU/GPU do app, e não custa nada: ninguém
   * está olhando. A voz continua intacta.
   */
  pauseVideoWhenHidden: boolean;
  /**
   * Além de parar de receber, também derrubar a qualidade do que *você* envia
   * enquanto a janela está fora da frente.
   *
   * Desligado por padrão: minimizar compartilhando costuma ser jogo em tela
   * cheia, e é justamente aí que a tela precisa estar boa do outro lado. Ligue
   * se preferir devolver esse trabalho de encoder para os seus FPS.
   */
  throttleWhenHidden: boolean;
}

export interface NotificationSettings {
  soundOnJoin: boolean;
  soundOnLeave: boolean;
  soundOnMessage: boolean;
  /** Volume dos avisos, 0–100. */
  volume: number;
  /** Aviso do sistema operacional quando chega mensagem no chat. */
  desktopOnMessage: boolean;
  /**
   * Só avisa com a janela em segundo plano. Ligado é o padrão porque notificar
   * quem já está olhando a conversa é barulho puro.
   */
  onlyWhenUnfocused: boolean;
  /** Mostrar o texto da mensagem no aviso. Desligado, aparece só quem mandou. */
  showPreview: boolean;
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
   * Quando o roteador não abre a porta (ou a operadora usa CGNAT), subir um
   * túnel de saída pela Cloudflare para que o convite funcione mesmo assim.
   * O binário é baixado na primeira vez e guardado no perfil do app.
   */
  useTunnel: boolean;
  /**
   * Usar STUN público para descobrir o endereço externo da mídia. Desligado,
   * voz e tela só funcionam na rede local — em compensação nenhum servidor de
   * terceiro é contatado.
   */
  useStun: boolean;
  /**
   * STUN/TURN próprios. Entram junto com os públicos (ou sozinhos, se o STUN
   * público estiver desligado). TURN é o que salva quem está atrás de CGNAT ou
   * firewall corporativo: sem ele, a mídia simplesmente não fecha.
   */
  iceServers: IceServerSetting[];
  /**
   * Ignorar caminhos diretos e passar tudo pelo TURN. Custa banda do servidor,
   * mas é o único jeito de provar que o TURN está mesmo funcionando.
   */
  forceRelay: boolean;
  /**
   * Malha: cada convidado fala direto com os outros em vez de tudo passar pelo
   * host. Tira o gargalo de upload do host (que hoje repassa o áudio de todo
   * mundo para todo mundo) ao custo de mais conexões em cada máquina.
   */
  mesh: boolean;
}

/** Um STUN/TURN escrito pela pessoa. `username`/`credential` só valem para TURN. */
export interface IceServerSetting {
  url: string;
  username: string;
  credential: string;
}

/** Quem entra na sala: qualquer um com o código, ou só quem o host liberar. */
export type ApprovalMode = 'auto' | 'manual';

export interface SecuritySettings {
  approval: ApprovalMode;
}

/** Um servidor em que já entramos, para voltar sem recolar o código. */
export interface RecentServer {
  /** Código completo, com token — é ele que faz a entrada funcionar. */
  invite: string;
  /** Como mostrar na lista: só o endereço, sem expor o token. */
  label: string;
  lastJoinedAt: number;
}

/**
 * A última sala em que estávamos, salva no disco para oferecer a volta depois
 * de uma queda — inclusive se o app inteiro morreu no meio da conversa.
 *
 * Guardamos os dois lados: o convidado volta pelo convite; o host reabre o
 * servidor com o *mesmo token*, e assim o código que os outros já têm continua
 * valendo. É o que faz a reconexão automática deles encontrar a sala de novo.
 */
export interface LastSession {
  role: 'host' | 'guest';
  /** Como mostrar para a pessoa: `192.168.0.7:51820`. */
  label: string;
  /** Convidado: código completo para reentrar. Host: vazio. */
  invite: string;
  username: string;
  /** Host: conversa, porta e token que mantêm o convite antigo válido. */
  conversationId?: string;
  port?: number;
  token?: string;
  /** Quando a sessão terminou. */
  endedAt: number;
  /**
   * `true` quando a conexão caiu sozinha (ou o app fechou no meio). Só nesse
   * caso vale interromper a tela inicial oferecendo voltar.
   */
  dropped: boolean;
  /** Motivo da queda, mostrado no convite de voltar. */
  reason?: string;
}

export interface AppSettings {
  /** Nome que já vem preenchido nas telas de criar/entrar. */
  username: string;
  /** Últimos servidores em que entrou, do mais recente para o mais antigo. */
  recentServers: RecentServer[];
  /** A última sala, para o "tentar reconectar?" da tela inicial. */
  lastSession: LastSession | null;
  /** Voltar sozinho para a sala quando a conexão cair. */
  autoReconnect: boolean;
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
  security: SecuritySettings;
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
    noiseSuppressionLevel: 'medium',
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
    // 1080p60 nítido não cabe em 6 Mbps; com teto baixo o encoder devolve a
    // diferença em borrão, que era metade da queixa de qualidade.
    maxBitrateMbps: 10,
    showCursor: true,
    pauseVideoWhenHidden: true,
    throttleWhenHidden: false,
  },
  notifications: {
    soundOnJoin: true,
    soundOnLeave: true,
    soundOnMessage: false,
    volume: 50,
    desktopOnMessage: true,
    onlyWhenUnfocused: true,
    showPreview: true,
  },
  network: {
    defaultPort: 51820,
    useUpnp: true,
    useTunnel: true,
    useStun: true,
    iceServers: [],
    forceRelay: false,
    mesh: false,
  },
  security: {
    approval: 'auto',
  },
  app: {
    username: '',
    recentServers: [],
    lastSession: null,
    autoReconnect: true,
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
    audio: migrateAudio(source.audio),
    chat: { ...DEFAULT_SETTINGS.chat, ...(source.chat ?? {}) },
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(source.shortcuts ?? {}) },
    screen: migrateScreen(source.screen),
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(source.notifications ?? {}) },
    network: {
      ...DEFAULT_SETTINGS.network,
      ...(source.network ?? {}),
      // Lista inteira ou nada: mesclar item a item deixaria servidor removido voltando.
      iceServers: sanitizeIceServers(source.network?.iceServers),
    },
    security: { ...DEFAULT_SETTINGS.security, ...(source.security ?? {}) },
    app: { ...DEFAULT_SETTINGS.app, ...(source.app ?? {}) },
    peers: { ...(source.peers ?? {}) },
  };
}

/**
 * Preferências de áudio de versões antigas continuam válidas: o antigo
 * interruptor `noiseSuppression` vira o nível equivalente.
 */
/** Os únicos valores que o resto do código sabe tratar. */
const NOISE_LEVELS: readonly NoiseSuppressionLevel[] = ['off', 'light', 'medium', 'max'];

function migrateAudio(stored: Partial<AudioSettings> | undefined): AudioSettings {
  const source = (stored ?? {}) as Partial<AudioSettings> & { noiseSuppression?: boolean };
  const audio: AudioSettings = { ...DEFAULT_SETTINGS.audio, ...source };

  if (source.noiseSuppressionLevel === undefined && typeof source.noiseSuppression === 'boolean') {
    audio.noiseSuppressionLevel = source.noiseSuppression ? 'medium' : 'off';
  }
  delete (audio as { noiseSuppression?: boolean }).noiseSuppression;

  // O arquivo é editável na mão, e um nível que não existe não é um detalhe:
  // `NOISE_PROFILES[nível]` sairia `undefined` e o microfone inteiro parava
  // de abrir, reportado como um erro genérico de captura.
  if (!NOISE_LEVELS.includes(audio.noiseSuppressionLevel)) {
    audio.noiseSuppressionLevel = DEFAULT_SETTINGS.audio.noiseSuppressionLevel;
  }
  return audio;
}

/**
 * Aceita só o que parece um STUN/TURN de verdade. O arquivo é editável na mão,
 * e uma URL torta aqui derruba a criação de *toda* conexão WebRTC — o erro
 * apareceria lá na frente como "a voz não conecta", sem pista nenhuma.
 */
export function sanitizeIceServers(value: unknown): IceServerSetting[] {
  if (!Array.isArray(value)) return [];

  const clean: IceServerSetting[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { url, username, credential } = entry as Partial<IceServerSetting>;
    if (typeof url !== 'string' || !isIceUrl(url)) continue;

    clean.push({
      url: url.trim(),
      username: typeof username === 'string' ? username : '',
      credential: typeof credential === 'string' ? credential : '',
    });
    if (clean.length >= MAX_ICE_SERVERS) break;
  }
  return clean;
}

/** `stun:` e `stuns:` não levam credencial; `turn:` e `turns:` levam. */
export function isIceUrl(url: string): boolean {
  return /^(stun|stuns|turn|turns):[^\s]+$/i.test(url.trim());
}

/** Monta a lista final para o WebRTC: os públicos (se ligados) mais os seus. */
export function buildIceServers(network: NetworkSettings, fallback: IceServerSetting[] | RTCIceServer[] = []): RTCIceServer[] {
  const list: RTCIceServer[] = [];

  if (network.useStun) {
    for (const server of fallback) {
      list.push('url' in server ? { urls: server.url } : (server as RTCIceServer));
    }
  }

  for (const server of sanitizeIceServers(network.iceServers)) {
    // Credencial vazia em TURN é erro de digitação comum; o navegador aceita e
    // falha calado na hora de alocar, então melhor não mandar o campo à toa.
    list.push(
      server.username || server.credential
        ? { urls: server.url, username: server.username, credential: server.credential }
        : { urls: server.url },
    );
  }

  return list;
}

/**
 * O teto de banda subiu junto com o preset padrão (6 -> 10 Mbps): 1080p60 não
 * cabe em 6 Mbps, e o teto é aplicado por cima do preset. Quem já tinha o app
 * instalado carrega o 6 salvo em disco e receberia a resolução nova espremida
 * no limite velho - exatamente o borrão que essa mudança veio consertar. Só o
 * valor que era o padrão antigo sobe; quem escolheu outro número escolheu.
 */
const OLD_DEFAULT_SCREEN_MBPS = 6;

function migrateScreen(stored: Partial<ScreenSettings> | undefined): ScreenSettings {
  const screen: ScreenSettings = { ...DEFAULT_SETTINGS.screen, ...(stored ?? {}) };

  if (screen.maxBitrateMbps === OLD_DEFAULT_SCREEN_MBPS) {
    screen.maxBitrateMbps = DEFAULT_SETTINGS.screen.maxBitrateMbps;
  }
  return screen;
}

/** Ajustes de uma pessoa, já com os padrões aplicados. */
export function peerSettings(settings: Settings, username: string): PeerSettings {
  return { ...DEFAULT_PEER_SETTINGS, ...(settings.peers[username] ?? {}) };
}
