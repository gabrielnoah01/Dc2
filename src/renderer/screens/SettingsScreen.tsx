import { useEffect, useState } from 'react';
import { useSettings } from '../state/settings';
import { Row, Section, Select, ShortcutInput, Slider, Toggle } from '../components/controls';
import { APP_NAME, MAX_USERNAME_LENGTH } from '@shared/constants';
import type { ConversationSummary } from '@shared/ipc';
import type { RetentionDays } from '@shared/settings';

type Tab = 'audio' | 'chat' | 'shortcuts' | 'screen' | 'people' | 'network' | 'app';

const TABS: { id: Tab; label: string }[] = [
  { id: 'audio', label: 'Voz e áudio' },
  { id: 'chat', label: 'Chat e histórico' },
  { id: 'shortcuts', label: 'Atalhos' },
  { id: 'screen', label: 'Tela' },
  { id: 'people', label: 'Pessoas' },
  { id: 'network', label: 'Rede' },
  { id: 'app', label: 'Aplicativo' },
];

export function SettingsScreen({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<Tab>('audio');
  const settings = useSettings((s) => s.settings);
  const save = useSettings((s) => s.save);
  const reset = useSettings((s) => s.reset);
  const setPeer = useSettings((s) => s.setPeer);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex bg-ink-900">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-ink-700 bg-ink-800 p-3">
        <h2 className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">
          Configurações
        </h2>
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
              tab === item.id
                ? 'bg-ink-600 text-slate-100'
                : 'text-slate-400 hover:bg-ink-700 hover:text-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
        <button
          className="mt-auto rounded-md px-3 py-2 text-left text-xs text-slate-500 hover:text-red-300"
          onClick={() => {
            if (confirm('Voltar tudo ao padrão de fábrica?')) void reset();
          }}
        >
          Restaurar padrões
        </button>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-ink-700 px-8 py-4">
          <h1 className="text-lg font-medium">{TABS.find((item) => item.id === tab)?.label}</h1>
          <button className="btn-ghost ml-auto" onClick={onClose}>
            Fechar (Esc)
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {tab === 'audio' && <AudioTab />}
            {tab === 'chat' && <ChatTab />}
            {tab === 'shortcuts' && <ShortcutsTab />}
            {tab === 'screen' && <ScreenTab />}
            {tab === 'people' && <PeopleTab />}
            {tab === 'network' && <NetworkTab />}
            {tab === 'app' && <AppTab />}
          </div>
        </div>
      </div>
    </div>
  );

  function AudioTab() {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const { audio } = settings;

    useEffect(() => {
      // A lista só vem com rótulo depois de o usuário liberar o microfone.
      void navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((track) => track.stop()))
        .catch(() => undefined)
        .then(() => navigator.mediaDevices.enumerateDevices())
        .then(setDevices)
        .catch(() => undefined);
    }, []);

    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const outputs = devices.filter((device) => device.kind === 'audiooutput');

    return (
      <>
        <Section title="Dispositivos">
          <Row label="Microfone">
            <Select
              value={audio.inputDeviceId}
              onChange={(inputDeviceId) => void save({ audio: { inputDeviceId } })}
              options={[
                { value: '', label: 'Padrão do sistema' },
                ...inputs.map((device) => ({
                  value: device.deviceId,
                  label: device.label || 'Microfone',
                })),
              ]}
            />
          </Row>
          <Row label="Saída de som" hint="Onde você ouve os outros">
            <Select
              value={audio.outputDeviceId}
              onChange={(outputDeviceId) => void save({ audio: { outputDeviceId } })}
              options={[
                { value: '', label: 'Padrão do sistema' },
                ...outputs.map((device) => ({
                  value: device.deviceId,
                  label: device.label || 'Saída',
                })),
              ]}
            />
          </Row>
        </Section>

        <Section title="Volumes">
          <Row label="Volume do microfone" hint="Quanto os outros te ouvem">
            <Slider
              value={audio.inputVolume}
              max={200}
              suffix="%"
              onChange={(inputVolume) => void save({ audio: { inputVolume } })}
            />
          </Row>
          <Row label="Volume geral" hint="Quanto você ouve todo mundo">
            <Slider
              value={audio.outputVolume}
              max={200}
              suffix="%"
              onChange={(outputVolume) => void save({ audio: { outputVolume } })}
            />
          </Row>
        </Section>

        <Section
          title="Modo de transmissão"
          hint="Voz aberta manda áudio o tempo todo; push-to-talk só enquanto a tecla estiver pressionada."
        >
          <Row label="Modo">
            <Select
              value={audio.voiceMode}
              onChange={(voiceMode) => void save({ audio: { voiceMode } })}
              options={[
                { value: 'open', label: 'Voz sempre aberta' },
                { value: 'ptt', label: 'Push-to-talk' },
              ]}
            />
          </Row>
          {audio.voiceMode === 'ptt' && (
            <Row
              label="Atraso ao soltar"
              hint="Mantém o microfone aberto por um instante para não cortar o fim da frase"
            >
              <Slider
                value={audio.pttReleaseDelay}
                min={150}
                max={1000}
                step={50}
                suffix="ms"
                onChange={(pttReleaseDelay) => void save({ audio: { pttReleaseDelay } })}
              />
            </Row>
          )}
          <Row
            label="Sensibilidade do indicador de fala"
            hint="Mais alto exige voz mais forte para acender o anel verde"
          >
            <Slider
              value={audio.speakingSensitivity}
              max={50}
              onChange={(speakingSensitivity) => void save({ audio: { speakingSensitivity } })}
            />
          </Row>
        </Section>

        <Section
          title="Processamento"
          hint="Desligue se usar microfone profissional com tratamento próprio."
        >
          <Row label="Cancelamento de eco" hint="Evita microfonia quando você usa caixa de som">
            <Toggle
              value={audio.echoCancellation}
              onChange={(echoCancellation) => void save({ audio: { echoCancellation } })}
            />
          </Row>
          <Row label="Supressão de ruído" hint="Corta ventilador, teclado, ar-condicionado">
            <Toggle
              value={audio.noiseSuppression}
              onChange={(noiseSuppression) => void save({ audio: { noiseSuppression } })}
            />
          </Row>
          <Row label="Ganho automático" hint="Nivela o volume da sua voz sozinho">
            <Toggle
              value={audio.autoGainControl}
              onChange={(autoGainControl) => void save({ audio: { autoGainControl } })}
            />
          </Row>
        </Section>
      </>
    );
  }

  function ChatTab() {
    const { chat } = settings;
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);

    const refresh = () =>
      void window.only.listConversations().then(setConversations).catch(() => undefined);
    useEffect(refresh, []);

    return (
      <>
        <Section
          title="Histórico"
          hint="Só quem abre o servidor guarda a conversa — os outros recebem as mensagens recentes ao entrar."
        >
          <Row
            label="Salvar a conversa"
            hint="Desligado, a sala funciona igual: só não fica registro novo em disco"
          >
            <Toggle
              value={chat.saveHistory}
              onChange={(saveHistory) => void save({ chat: { saveHistory } })}
            />
          </Row>
          <Row label="Apagar mensagens automaticamente" hint="Contado a partir da data de cada mensagem">
            <Select
              value={String(chat.retentionDays)}
              onChange={(value) =>
                void save({ chat: { retentionDays: Number(value) as RetentionDays } })
              }
              options={[
                { value: '1', label: 'Depois de 1 dia' },
                { value: '7', label: 'Depois de 7 dias' },
                { value: '30', label: 'Depois de 30 dias' },
                { value: '-1', label: 'Nunca apagar' },
              ]}
            />
          </Row>
          <Row label="Mensagens enviadas a quem entra">
            <Slider
              value={chat.historyOnJoin}
              min={0}
              max={500}
              step={25}
              onChange={(historyOnJoin) => void save({ chat: { historyOnJoin } })}
            />
          </Row>
        </Section>

        <Section title="Imagens">
          <Row label="Tamanho máximo por imagem" hint="Acima disso a compressão aperta mais">
            <Slider
              value={chat.maxImageMb}
              min={1}
              max={8}
              suffix=" MB"
              onChange={(maxImageMb) => void save({ chat: { maxImageMb } })}
            />
          </Row>
          <Row label="Qualidade da compressão">
            <Slider
              value={chat.imageQuality}
              min={30}
              max={100}
              onChange={(imageQuality) => void save({ chat: { imageQuality } })}
            />
          </Row>
        </Section>

        <Section title="Conversas salvas" hint="Guardadas no seu PC, em %APPDATA%\Only\conversations.">
          {conversations.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma conversa salva ainda.</p>
          )}
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className="flex items-center gap-3 rounded-md bg-ink-800 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-200">{conversation.name}</p>
                <p className="text-xs text-slate-500">
                  {conversation.messageCount} mensagens
                  {conversation.attachmentBytes > 0 &&
                    ` · ${(conversation.attachmentBytes / (1024 * 1024)).toFixed(1)} MB em imagens`}
                </p>
              </div>
              <button
                className="text-xs text-slate-500 hover:text-amber-300"
                onClick={() => {
                  if (confirm(`Apagar as mensagens de "${conversation.name}"?`)) {
                    void window.only.clearConversation(conversation.id).then(refresh);
                  }
                }}
              >
                limpar
              </button>
              <button
                className="text-xs text-slate-500 hover:text-red-300"
                onClick={() => {
                  if (confirm(`Excluir a conversa "${conversation.name}" de vez?`)) {
                    void window.only.deleteConversation(conversation.id).then(refresh);
                  }
                }}
              >
                excluir
              </button>
            </div>
          ))}
        </Section>
      </>
    );
  }

  function ShortcutsTab() {
    const { shortcuts } = settings;
    return (
      <>
        <Section
          title="Atalhos globais"
          hint="Funcionam mesmo com o Only atrás de um jogo ou de outra janela."
        >
          <Row label="Ativar atalhos globais">
            <Toggle
              value={shortcuts.global}
              onChange={(global) => void save({ shortcuts: { global } })}
            />
          </Row>
          <Row label="Mutar / desmutar microfone">
            <ShortcutInput
              value={shortcuts.toggleMute}
              onChange={(toggleMute) => void save({ shortcuts: { toggleMute } })}
            />
          </Row>
          <Row label="Ensurdecer" hint="Para de ouvir todo mundo e cala seu microfone junto">
            <ShortcutInput
              value={shortcuts.toggleDeafen}
              onChange={(toggleDeafen) => void save({ shortcuts: { toggleDeafen } })}
            />
          </Row>
          <Row
            label="Push-to-talk"
            hint={
              settings.audio.voiceMode === 'ptt'
                ? 'Segure para falar'
                : 'Só tem efeito no modo push-to-talk'
            }
          >
            <ShortcutInput
              value={shortcuts.pushToTalk}
              onChange={(pushToTalk) => void save({ shortcuts: { pushToTalk } })}
            />
          </Row>
        </Section>
        <p className="text-xs text-slate-500">
          Combinações já usadas por outro programa são recusadas na hora da gravação — se
          aparecer aviso, escolha outra.
        </p>
      </>
    );
  }

  function ScreenTab() {
    const { screen } = settings;
    return (
      <Section title="Compartilhamento de tela">
        <Row label="Modo padrão" hint="Já vem selecionado quando você abre o seletor de tela">
          <Select
            value={screen.defaultPreset}
            onChange={(defaultPreset) => void save({ screen: { defaultPreset } })}
            options={[
              { value: 'fluid', label: 'Fluidez — 720p a 120 fps' },
              { value: 'sharp', label: 'Nitidez — 1440p a 60 fps' },
            ]}
          />
        </Row>
        <Row label="Teto de banda por tela" hint="Baixe se a transmissão travar pela internet">
          <Slider
            value={screen.maxBitrateMbps}
            min={1}
            max={20}
            suffix=" Mbps"
            onChange={(maxBitrateMbps) => void save({ screen: { maxBitrateMbps } })}
          />
        </Row>
        <Row label="Mostrar o cursor do mouse">
          <Toggle
            value={screen.showCursor}
            onChange={(showCursor) => void save({ screen: { showCursor } })}
          />
        </Row>
      </Section>
    );
  }

  function PeopleTab() {
    const names = Object.keys(settings.peers).sort((a, b) => a.localeCompare(b));

    if (names.length === 0) {
      return (
        <p className="text-sm text-slate-500">
          Ninguém ajustado ainda. Dentro de um servidor, clique numa pessoa na lista para
          silenciá-la ou mudar o volume dela — só para você. Os ajustes aparecem aqui.
        </p>
      );
    }

    return (
      <Section
        title="Ajustes por pessoa"
        hint="Valem só para você. A pessoa não é avisada e continua sendo ouvida pelos outros."
      >
        {names.map((name) => {
          const peer = settings.peers[name];
          return (
            <div key={name} className="flex flex-col gap-2 rounded-md bg-ink-800 p-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 truncate text-sm text-slate-200">{name}</span>
                <button
                  className="text-xs text-slate-500 hover:text-red-300"
                  onClick={() => {
                    const peers = { ...settings.peers };
                    delete peers[name];
                    void save({ peers });
                  }}
                >
                  esquecer
                </button>
              </div>
              <Row label="Silenciada">
                <Toggle value={peer.muted} onChange={(muted) => void setPeer(name, { muted })} />
              </Row>
              <Row label="Volume">
                <Slider
                  value={peer.volume}
                  max={200}
                  suffix="%"
                  onChange={(volume) => void setPeer(name, { volume })}
                />
              </Row>
            </div>
          );
        })}
      </Section>
    );
  }

  function NetworkTab() {
    const { network } = settings;
    return (
      <Section title="Rede">
        <Row label="Porta padrão" hint="Usada ao criar um servidor">
          <input
            className="field w-32"
            value={String(network.defaultPort)}
            inputMode="numeric"
            onChange={(event) => {
              const defaultPort = Number(event.target.value.replace(/[^0-9]/g, '').slice(0, 5));
              if (defaultPort > 0) void save({ network: { defaultPort } });
            }}
          />
        </Row>
        <Row
          label="Abrir a porta automaticamente (UPnP)"
          hint="Desligue se preferir liberar a porta na mão no roteador"
        >
          <Toggle
            value={network.useUpnp}
            onChange={(useUpnp) => void save({ network: { useUpnp } })}
          />
        </Row>
        <Row
          label="Usar STUN público"
          hint="Necessário para voz e tela pela internet. Desligado, só funciona na rede local — e nenhum servidor de terceiro é contatado."
        >
          <Toggle
            value={network.useStun}
            onChange={(useStun) => void save({ network: { useStun } })}
          />
        </Row>
      </Section>
    );
  }

  function AppTab() {
    const { app, notifications } = settings;
    return (
      <>
        <Section title="Identidade">
          <Row label="Seu nome" hint="Vem preenchido ao criar ou entrar num servidor">
            <input
              className="field w-64"
              value={app.username}
              maxLength={MAX_USERNAME_LENGTH}
              placeholder="como os outros vão te ver"
              onChange={(event) => void save({ app: { username: event.target.value } })}
            />
          </Row>
        </Section>

        <Section title="Janela">
          <Row
            label="Fechar manda para a bandeja"
            hint="Importante para quem hospeda: fechar a janela derrubaria a conversa de todo mundo"
          >
            <Toggle
              value={app.minimizeToTray}
              onChange={(minimizeToTray) => void save({ app: { minimizeToTray } })}
            />
          </Row>
          <Row label="Abrir junto com o Windows">
            <Toggle
              value={app.startWithWindows}
              onChange={(startWithWindows) => void save({ app: { startWithWindows } })}
            />
          </Row>
          <Row
            label="Procurar atualizações ao abrir"
            hint={`Host e convidado precisam da mesma versão do ${APP_NAME} para conversar`}
          >
            <Toggle
              value={app.checkUpdates}
              onChange={(checkUpdates) => void save({ app: { checkUpdates } })}
            />
          </Row>
        </Section>

        <Section title="Avisos sonoros">
          <Row label="Alguém entrou">
            <Toggle
              value={notifications.soundOnJoin}
              onChange={(soundOnJoin) => void save({ notifications: { soundOnJoin } })}
            />
          </Row>
          <Row label="Alguém saiu">
            <Toggle
              value={notifications.soundOnLeave}
              onChange={(soundOnLeave) => void save({ notifications: { soundOnLeave } })}
            />
          </Row>
          <Row label="Mensagem no chat">
            <Toggle
              value={notifications.soundOnMessage}
              onChange={(soundOnMessage) => void save({ notifications: { soundOnMessage } })}
            />
          </Row>
          <Row label="Volume dos avisos">
            <Slider
              value={notifications.volume}
              onChange={(volume) => void save({ notifications: { volume } })}
            />
          </Row>
        </Section>
      </>
    );
  }
}
