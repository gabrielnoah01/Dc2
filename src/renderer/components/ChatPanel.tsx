import { useEffect, useRef, useState } from 'react';
import type { Attachment, ChatMessage } from '@shared/protocol';
import { MAX_CHAT_LENGTH } from '@shared/constants';
import type { ChatPayload, OutgoingAttachment } from '@shared/ipc';
import { useSettings } from '../state/settings';
import { compressImage } from '../image';
import { Icon } from './Icons';

interface Props {
  messages: ChatMessage[];
  selfId: string;
  /** Com alguém compartilhando tela o chat cede espaço para o vídeo. */
  compact: boolean;
  onSend(payload: ChatPayload): void;
}

export function ChatPanel({ messages, selfId, compact, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<OutgoingAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const chat = useSettings((s) => s.settings.chat);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function attach(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('só dá para mandar imagem por enquanto');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setPending(await compressImage(file, chat.maxImageMb, chat.imageQuality));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'não deu para preparar a imagem');
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = draft.trim();
    if (!text && !pending) return;
    onSend({ text, ...(pending ? { attachment: pending } : {}) });
    setDraft('');
    setPending(null);
  }

  return (
    <section
      className={`relative flex min-h-0 flex-col ${compact ? 'h-56' : 'flex-1'}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void attach(event.dataTransfer.files[0]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex animate-fade-in items-center justify-center rounded-xl border-2 border-dashed border-accent bg-ink-950/85 text-sm text-accent backdrop-blur-sm">
          Solte a imagem para anexar
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-sm text-slate-500">
            Nada por aqui ainda. Escreva, cole (Ctrl+V) ou arraste uma imagem.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="animate-fade-up text-sm leading-relaxed">
            <span
              className={`font-medium ${message.fromId === selfId ? 'text-accent' : 'text-slate-200'}`}
            >
              {message.username}
            </span>
            <span className="ml-2 text-[11px] text-slate-600">{formatTime(message.ts)}</span>
            {message.text && (
              <p className="whitespace-pre-wrap break-words text-slate-300">{message.text}</p>
            )}
            {message.attachment && (
              <AttachmentView
                messageId={message.id}
                attachment={message.attachment}
                onOpen={setLightbox}
              />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-3 pb-1 text-xs text-amber-300" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {pending && (
        <div className="mx-3 mb-2 flex animate-pop-in items-center gap-3 rounded-lg bg-ink-800 p-2 ring-1 ring-ink-600">
          <img src={pending.dataUrl} alt="" className="h-14 w-20 rounded object-cover" />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
            {pending.name} · {formatSize(estimateBytes(pending.dataUrl))}
          </span>
          <button
            className="text-xs text-slate-500 hover:text-red-300"
            onClick={() => setPending(null)}
          >
            remover
          </button>
        </div>
      )}

      <div className="flex gap-2 border-t border-ink-600 p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            void attach(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <button
          className="btn-ghost px-3"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Anexar imagem"
        >
          {busy ? <span className="animate-pulse">···</span> : <Icon.paperclip size={16} />}
        </button>
        <input
          className="field flex-1"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Escreva uma mensagem"
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            // Ctrl+V com print na área de transferência: o caminho mais usado.
            const file = [...event.clipboardData.items]
              .find((item) => item.type.startsWith('image/'))
              ?.getAsFile();
            if (file) {
              event.preventDefault();
              void attach(file);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          className="btn-primary"
          onClick={send}
          disabled={busy || (draft.trim().length === 0 && !pending)}
        >
          <Icon.send size={15} />
          Enviar
        </button>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-ink-950/90 p-6 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full animate-pop-in rounded-lg object-contain shadow-pop"
          />
        </div>
      )}
    </section>
  );
}

/**
 * Imagem da mensagem. Do histórico antigo pode vir só o descritor (sem os
 * bytes) — nesse caso mostramos um marcador e buscamos sob demanda, para
 * entrar na sala não custar centenas de megabytes de fotos velhas.
 */
function AttachmentView({
  messageId,
  attachment,
  onOpen,
}: {
  messageId: string;
  attachment: Attachment;
  onOpen(dataUrl: string): void;
}) {
  const [loading, setLoading] = useState(false);

  if (!attachment.dataUrl) {
    return (
      <button
        className="mt-1 flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-2 text-xs text-slate-400 ring-1 ring-ink-600 transition-colors hover:ring-accent"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          void window.only.requestAttachment(messageId);
        }}
      >
        <Icon.image size={14} />
        {attachment.name} · {formatSize(attachment.size)}
        <span className="text-slate-500">{loading ? 'carregando…' : 'clique para ver'}</span>
      </button>
    );
  }

  return (
    <button
      className="mt-1 block max-w-sm overflow-hidden rounded-lg ring-1 ring-ink-600 transition-all duration-200 hover:scale-[1.01] hover:ring-accent"
      onClick={() => onOpen(attachment.dataUrl!)}
      title={`${attachment.name} · ${formatSize(attachment.size)}`}
    >
      <img
        src={attachment.dataUrl}
        alt={attachment.name}
        className="max-h-64 w-full object-contain"
        // Reserva o espaço certo antes de decodificar: evita o chat pular.
        width={attachment.width || undefined}
        height={attachment.height || undefined}
      />
    </button>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** base64 ocupa ~4/3 do original. */
function estimateBytes(dataUrl: string): number {
  return Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
}
