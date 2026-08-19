import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Participant } from '@shared/protocol';
import type { Role, ScreenSource, ShortcutAction } from '@shared/ipc';
import { peerSettings, type Settings } from '@shared/settings';
import { VoiceManager } from './voiceManager';
import { ScreenShareManager, type RemoteScreen } from './screenShareManager';
import type { SharePresetId } from './quality';
import { EMPTY_HEALTH, NetHealthProbe, SAMPLE_INTERVAL_MS, type NetHealth } from './netHealth';
import { useSettings } from '../state/settings';

interface SessionInfo {
  role: Role;
  selfId: string;
  participants: Participant[];
}

interface MediaSession {
  micReady: boolean;
  muted: boolean;
  deafened: boolean;
  speakingIds: string[];
  sharingLocally: boolean;
  localScreen: MediaStream | null;
  /** Telas das outras pessoas — várias ao mesmo tempo é normal. */
  remoteScreens: RemoteScreen[];
  mediaError: string | null;
  /** Como a rede está indo agora — atualiza sozinho enquanto a sessão vive. */
  health: NetHealth;
  toggleMute(): void;
  toggleDeafen(): void;
  listSources(): Promise<ScreenSource[]>;
  startShare(sourceId: string, preset: SharePresetId): Promise<void>;
  stopShare(): void;
}

/**
 * Amarra as duas conexões WebRTC (voz e tela) ao ciclo de vida da sessão, e
 * liga nelas as preferências do usuário e os atalhos globais.
 */
export function useMediaSession({ role, selfId, participants }: SessionInfo): MediaSession {
  const voiceRef = useRef<VoiceManager | null>(null);
  const screenRef = useRef<ScreenShareManager | null>(null);

  const settings = useSettings((s) => s.settings);
  const [micReady, setMicReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  const [sharingLocally, setSharingLocally] = useState(false);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<RemoteScreen[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [health, setHealth] = useState<NetHealth>(EMPTY_HEALTH);

  const isHost = role === 'host';
  const hostId = isHost ? selfId : (participants.find((p) => p.isHost)?.id ?? null);

  /**
   * O gerente de voz conhece ids; as preferências são salvas por nome (id muda
   * a cada sessão, nome não). Esta ponte fica num ref para o gerente não
   * precisar ser recriado toda vez que a lista de gente muda.
   */
  const audienceRef = useRef<{ participants: Participant[]; settings: Settings }>({
    participants,
    settings,
  });
  audienceRef.current = { participants, settings };

  const resolvePeerAudio = useCallback((ownerId: string) => {
    const { participants: list, settings: current } = audienceRef.current;
    const username = list.find((p) => p.id === ownerId)?.username;
    if (!username) return { volume: 100, muted: false };
    const peer = peerSettings(current, username);
    return { volume: peer.volume, muted: peer.muted };
  }, []);

  useEffect(() => {
    if (role === null || !selfId) return;

    const voice = new VoiceManager(
      {
        selfId,
        isHost,
        hostId,
        onSpeaking: setSpeakingIds,
        onError: setMediaError,
        resolvePeerAudio,
      },
      audienceRef.current.settings.audio,
    );
    const screen = new ScreenShareManager({
      selfId,
      isHost,
      hostId,
      onRemoteScreens: setRemoteScreens,
      onLocalStream: (stream) => {
        setLocalScreen(stream);
        setSharingLocally(stream !== null);
      },
      onLocalStopped: () => {
        void window.only.setScreenShare(false);
      },
      onError: setMediaError,
    });

    voiceRef.current = voice;
    screenRef.current = screen;

    void voice.startMicrophone().then((ok) => {
      setMicReady(ok);
      setMuted(voice.isMuted);
    });

    const offSignal = window.only.onSignal((signal) => {
      if (signal.channel === 'screen') screen.handleSignal(signal);
      else voice.handleSignal(signal);
    });

    return () => {
      offSignal();
      voice.stop();
      screen.dispose();
      voiceRef.current = null;
      screenRef.current = null;
      setMicReady(false);
      setSpeakingIds([]);
      setLocalScreen(null);
      setRemoteScreens([]);
      setSharingLocally(false);
    };
    // `hostId` só muda quando a sessão em si muda (host é fixo enquanto ela vive).
  }, [role, selfId, isHost, hostId, resolvePeerAudio]);

  // Abre/fecha conexões conforme gente entra e sai.
  useEffect(() => {
    const ids = participants.map((p) => p.id);
    voiceRef.current?.syncPeers(ids);
    screenRef.current?.syncPeers(ids);
  }, [participants]);

  // Preferências mudaram: dispositivo, ganho, volumes, modo de voz.
  useEffect(() => {
    void voiceRef.current?.applySettings(settings.audio);
  }, [settings.audio]);

  // Volume/silenciamento individuais.
  useEffect(() => {
    voiceRef.current?.refreshVolumes();
  }, [settings.peers, participants]);

  const toggleMute = useCallback(() => {
    const voice = voiceRef.current;
    if (!voice) return;
    const next = !voice.isMuted;
    voice.setMuted(next);
    setMuted(next);
    // Sair do mudo enquanto ensurdecido não faz sentido: religa a audição junto.
    if (!next && voice.isDeafened) {
      voice.setDeafened(false);
      setDeafened(false);
    }
  }, []);

  const toggleDeafen = useCallback(() => {
    const voice = voiceRef.current;
    if (!voice) return;
    const next = !voice.isDeafened;
    voice.setDeafened(next);
    setDeafened(next);
    setMuted(voice.isMuted);
  }, []);

  // Atalhos globais chegam do processo principal.
  useEffect(() => {
    return window.only.onShortcut((action: ShortcutAction) => {
      const voice = voiceRef.current;
      if (!voice) return;
      switch (action) {
        case 'toggle-mute':
          toggleMute();
          break;
        case 'toggle-deafen':
          toggleDeafen();
          break;
        case 'ptt-down':
          voice.setTransmitting(true);
          break;
        case 'ptt-up':
          voice.setTransmitting(false);
          break;
      }
    });
  }, [toggleMute, toggleDeafen]);

  const listSources = useCallback(() => window.only.getScreenSources(), []);

  const startShare = useCallback(async (sourceId: string, preset: SharePresetId) => {
    const screen = screenRef.current;
    if (!screen) return;
    const ok = await screen.start(sourceId, preset);
    if (ok) await window.only.setScreenShare(true);
  }, []);

  // Medição de rede: uma amostra a cada poucos segundos, só enquanto a sessão
  // existe. `getStats()` é barato, mas não de graça — daí o intervalo largo.
  useEffect(() => {
    const probe = new NetHealthProbe();
    let cancelled = false;

    async function tick(): Promise<void> {
      const voice = voiceRef.current;
      const screen = screenRef.current;
      if (!voice && !screen) return;
      const next = await probe.sample([
        ...(voice?.activeLinks() ?? []),
        ...(screen?.activeLinks() ?? []),
      ]);
      if (!cancelled) setHealth(next);
    }

    const timer = window.setInterval(() => void tick(), SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setHealth(EMPTY_HEALTH);
    };
  }, [selfId]);

  const stopShare = useCallback(() => {
    screenRef.current?.stopSharing();
    void window.only.setScreenShare(false);
  }, []);

  return useMemo(
    () => ({
      micReady,
      muted,
      deafened,
      speakingIds,
      sharingLocally,
      localScreen,
      remoteScreens,
      mediaError,
      health,
      toggleMute,
      toggleDeafen,
      listSources,
      startShare,
      stopShare,
    }),
    [
      micReady,
      muted,
      deafened,
      speakingIds,
      sharingLocally,
      localScreen,
      remoteScreens,
      mediaError,
      health,
      toggleMute,
      toggleDeafen,
      listSources,
      startShare,
      stopShare,
    ],
  );
}
