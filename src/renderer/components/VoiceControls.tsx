import { useState } from 'react';
import type { ScreenSource } from '@shared/ipc';
import { ScreenPicker } from './ScreenPicker';
import { Icon } from './Icons';
import type { SharePresetId } from '../webrtc/quality';

interface Props {
  muted: boolean;
  deafened: boolean;
  micReady: boolean;
  sharing: boolean;
  leaving: boolean;
  isHost: boolean;
  participantCount: number;
  /** Quantas telas estão no ar — várias ao mesmo tempo é permitido. */
  sharerCount: number;
  listSources(): Promise<ScreenSource[]>;
  onStartShare(sourceId: string, preset: SharePresetId): Promise<void>;
  onStopShare(): void;
  onToggleMute(): void;
  onToggleDeafen(): void;
  onOpenSettings(): void;
  onLeave(): void;
}

export function VoiceControls(props: Props) {
  const [picking, setPicking] = useState(false);

  async function pick(sourceId: string, preset: SharePresetId) {
    await props.onStartShare(sourceId, preset);
    setPicking(false);
  }

  return (
    <>
      <footer className="flex items-center gap-3 border-t border-ink-700/70 bg-ink-800/70 px-4 py-3 backdrop-blur-sm">
        <button
          className={props.muted ? 'btn bg-red-900 text-red-100 hover:bg-red-800' : 'btn-ghost'}
          onClick={props.onToggleMute}
          disabled={!props.micReady}
          title={props.micReady ? '' : 'microfone indisponível'}
        >
          {props.muted ? <Icon.micOff size={15} /> : <Icon.mic size={15} />}
          {props.muted ? 'Sem microfone' : 'Microfone ligado'}
        </button>

        <button
          className={props.deafened ? 'btn bg-red-900 text-red-100 hover:bg-red-800' : 'btn-ghost'}
          onClick={props.onToggleDeafen}
          title="Para de ouvir todo mundo e cala seu microfone junto"
        >
          {props.deafened ? <Icon.headphonesOff size={15} /> : <Icon.headphones size={15} />}
          {props.deafened ? 'Sem ouvir' : 'Ouvindo'}
        </button>

        {props.sharing ? (
          <button className="btn bg-red-900 text-red-100 hover:bg-red-800" onClick={props.onStopShare}>
            <Icon.screen size={15} />
            Parar de compartilhar
          </button>
        ) : (
          <button
            className="btn-ghost"
            onClick={() => setPicking(true)}
          >
            <Icon.screenShare size={15} />
            Compartilhar tela
          </button>
        )}

        <span className="ml-auto text-xs text-slate-500">
          {props.participantCount} conectado(s)
          {props.sharerCount > 0 && ` · ${props.sharerCount} tela(s) no ar`}
        </span>

        <button className="btn-ghost px-3" onClick={props.onOpenSettings} title="Configurações">
          <Icon.settings size={16} />
        </button>

        <button
          className="btn bg-red-900 text-red-100 hover:bg-red-800"
          onClick={props.onLeave}
          disabled={props.leaving}
        >
          <Icon.exit size={15} />
          {props.isHost ? 'Encerrar servidor' : 'Sair'}
        </button>
      </footer>

      {picking && (
        <ScreenPicker
          listSources={props.listSources}
          onConfirm={pick}
          onCancel={() => setPicking(false)}
        />
      )}
    </>
  );
}
