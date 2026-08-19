import { useMemo, useState } from 'react';
import { useSession, participantName } from '../state/store';
import { useMediaSession } from '../webrtc/useMediaSession';
import { ParticipantList } from '../components/ParticipantList';
import { ChatPanel } from '../components/ChatPanel';
import { VoiceControls } from '../components/VoiceControls';
import { ScreenShareView, type ScreenTile } from '../components/ScreenShareView';
import { InviteBar } from '../components/InviteBar';
import { JoinRequests } from '../components/JoinRequests';
import { useSettings } from '../state/settings';

export function ServerScreen() {
  const role = useSession((s) => s.role);
  const selfId = useSession((s) => s.selfId);
  const participants = useSession((s) => s.participants);
  const messages = useSession((s) => s.messages);
  const screenSharerIds = useSession((s) => s.screenSharerIds);
  const connection = useSession((s) => s.connection);
  const lastError = useSession((s) => s.lastError);
  const endSession = useSession((s) => s.endSession);
  const setError = useSession((s) => s.setError);

  const media = useMediaSession({ role, selfId, participants });
  const setSettingsOpen = useSettings((s) => s.setOpen);
  const [leaving, setLeaving] = useState(false);

  const isHost = role === 'host';

  /**
   * A minha tela vem da prévia local; as outras chegam por WebRTC. Junto as
   * duas fontes numa lista só para a grade não precisar saber dessa diferença.
   */
  const tiles = useMemo<ScreenTile[]>(() => {
    const list: ScreenTile[] = [];

    if (media.sharingLocally) {
      list.push({ ownerId: selfId, label: 'Você', stream: media.localScreen, isLocal: true });
    }

    for (const screen of media.remoteScreens) {
      list.push({
        ownerId: screen.ownerId,
        label: participantName(participants, screen.ownerId),
        stream: screen.stream,
        isLocal: false,
      });
    }

    // Quem o host anunciou mas cujo vídeo ainda não chegou entra como "carregando",
    // para a grade não piscar quando alguém começa a compartilhar.
    for (const ownerId of screenSharerIds ?? []) {
      if (list.some((tile) => tile.ownerId === ownerId)) continue;
      list.push({
        ownerId,
        label: ownerId === selfId ? 'Você' : participantName(participants, ownerId),
        stream: null,
        isLocal: ownerId === selfId,
      });
    }

    return list;
  }, [media.sharingLocally, media.localScreen, media.remoteScreens, screenSharerIds, participants, selfId]);

  const sharing = tiles.length > 0;

  async function leave() {
    setLeaving(true);
    await window.only.leave();
    endSession();
  }

  return (
    <div className="flex h-full flex-col">
      {isHost && connection && <InviteBar connection={connection} />}
      {isHost && <JoinRequests />}

      {(lastError || media.mediaError) && (
        <div className="flex items-center justify-between gap-4 bg-red-950/60 px-4 py-2 text-sm text-red-300">
          <span>{lastError ?? media.mediaError}</span>
          {lastError && (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setError(null)}>
              ok
            </button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ParticipantList
          participants={participants}
          selfId={selfId}
          speakingIds={media.speakingIds}
          screenSharerIds={screenSharerIds}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <ScreenShareView tiles={tiles} />
          <ChatPanel
            messages={messages}
            selfId={selfId}
            compact={sharing}
            onSend={(payload) => void window.only.sendChat(payload)}
          />
        </main>
      </div>

      <VoiceControls
        muted={media.muted}
        deafened={media.deafened}
        micReady={media.micReady}
        sharing={media.sharingLocally}
        leaving={leaving}
        isHost={isHost}
        participantCount={participants.length}
        sharerCount={tiles.length}
        health={media.health}
        participants={participants}
        listSources={media.listSources}
        onStartShare={media.startShare}
        onStopShare={media.stopShare}
        onToggleMute={media.toggleMute}
        onToggleDeafen={media.toggleDeafen}
        onOpenSettings={() => setSettingsOpen(true)}
        onLeave={leave}
      />
    </div>
  );
}
