import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@shared/protocol';
import { MAX_CHAT_LENGTH } from '@shared/constants';

interface Props {
  messages: ChatMessage[];
  selfId: string;
  /** Com alguém compartilhando tela o chat cede espaço para o vídeo. */
  compact: boolean;
  onSend(text: string): void;
}

export function ChatPanel({ messages, selfId, compact, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  }

  return (
    <section className={`flex min-h-0 flex-col ${compact ? 'h-56' : 'flex-1'}`}>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-sm text-slate-500">
            Ninguém falou nada ainda. O histórico vive só enquanto o servidor estiver aberto.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="text-sm leading-relaxed">
            <span
              className={`font-medium ${message.fromId === selfId ? 'text-accent' : 'text-slate-200'}`}
            >
              {message.username}
            </span>
            <span className="ml-2 text-[11px] text-slate-600">{formatTime(message.ts)}</span>
            <p className="whitespace-pre-wrap break-words text-slate-300">{message.text}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t border-ink-600 p-3">
        <input
          className="field flex-1"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Escreva uma mensagem"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn-primary" onClick={send} disabled={draft.trim().length === 0}>
          Enviar
        </button>
      </div>
    </section>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
