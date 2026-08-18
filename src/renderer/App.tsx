import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@shared/ipc';
import { useSession } from './state/store';
import { HomeScreen } from './screens/HomeScreen';
import { ServerScreen } from './screens/ServerScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { SettingsScreen } from './screens/SettingsScreen';
import { Splash } from './components/Splash';
import { TitleBar } from './components/TitleBar';
import { initSettings, useSettings } from './state/settings';
import { applyRuntimeSettings } from './webrtc/runtime';
import { playCue } from './sounds';

export function App() {
  const role = useSession((s) => s.role);
  const setParticipants = useSession((s) => s.setParticipants);
  const addMessage = useSession((s) => s.addMessage);
  const setHistory = useSession((s) => s.setHistory);
  const setAttachmentData = useSession((s) => s.setAttachmentData);
  const setScreenSharers = useSession((s) => s.setScreenSharers);
  const endSession = useSession((s) => s.endSession);
  const setError = useSession((s) => s.setError);
  const applyConnectionUpdate = useSession((s) => s.applyConnectionUpdate);
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const receiveSettings = useSettings((s) => s.receive);
  const settingsOpen = useSettings((s) => s.open);
  const setSettingsOpen = useSettings((s) => s.setOpen);

  const settings = useSettings((s) => s.settings);
  const settingsLoaded = useSettings((s) => s.loaded);

  useEffect(() => {
    void initSettings();
  }, []);

  // Código fora do React (WebRTC) lê daqui.
  useEffect(() => {
    applyRuntimeSettings(settings);
  }, [settings]);

  // Eventos do main valem para as duas telas — assinamos uma vez só.
  useEffect(() => {
    const unsubscribers = [
      window.only.onParticipants((next) => {
        announcePresence(next);
        setParticipants(next);
      }),
      window.only.onChat((message) => {
        const { notifications } = useSettings.getState().settings;
        if (notifications.soundOnMessage) playCue('message', notifications.volume);
        addMessage(message);
      }),
      window.only.onScreenShare(setScreenSharers),
      window.only.onDisconnected(endSession),
      window.only.onError(setError),
      window.only.onUpdate(setUpdate),
      window.only.onConnection(applyConnectionUpdate),
      window.only.onSettings(receiveSettings),
      window.only.onHistory(setHistory),
      window.only.onAttachment(({ messageId, dataUrl }) =>
        setAttachmentData(messageId, dataUrl),
      ),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [
    setParticipants,
    addMessage,
    setScreenSharers,
    endSession,
    setError,
    applyConnectionUpdate,
    receiveSettings,
    setHistory,
    setAttachmentData,
  ]);

  return (
    <div className="flex h-full flex-col">
      <Splash ready={settingsLoaded} />
      <TitleBar />
      <UpdateBanner status={update} />
      <div className="min-h-0 flex-1">
        {role === null ? <HomeScreen /> : <ServerScreen />}
      </div>
      {settingsOpen && <SettingsScreen onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/**
 * Compara com a lista anterior para saber quem entrou e quem saiu — o
 * protocolo manda a lista inteira, não eventos individuais.
 */
let previousIds: string[] = [];

function announcePresence(next: { id: string }[]): void {
  const { notifications } = useSettings.getState().settings;
  const nextIds = next.map((participant) => participant.id);

  // Na primeira lista (você acabou de entrar) todo mundo é "novo": não avisa.
  if (previousIds.length > 0) {
    const joined = nextIds.some((id) => !previousIds.includes(id));
    const left = previousIds.some((id) => !nextIds.includes(id));
    if (joined && notifications.soundOnJoin) playCue('join', notifications.volume);
    if (left && notifications.soundOnLeave) playCue('leave', notifications.volume);
  }

  previousIds = nextIds;
}
