import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Attachment, ChatMessage } from '../shared/protocol';
import type { RetentionDays } from '../shared/settings';

/**
 * Histórico das conversas, no disco do host.
 *
 * O host é dono da sala, então é ele quem guarda — ninguém mais acumula
 * gigabytes de imagem dos outros. Quem entra recebe as últimas mensagens.
 *
 * Formato: um JSON por linha (`messages.jsonl`). Mandar uma mensagem vira um
 * append de uma linha, sem reescrever nada. Só a limpeza por retenção reescreve
 * o arquivo inteiro, e ela roda de hora em hora, não a cada mensagem.
 *
 * Imagens ficam como arquivo em `attachments/`; no JSONL vai só o descritor.
 * Guardar base64 dentro do JSONL inflaria o arquivo em 33% e tornaria a leitura
 * do histórico lenta mesmo quando ninguém quer ver as fotos.
 */

export interface ConversationSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** Espaço ocupado pelas imagens, em bytes. */
  attachmentBytes: number;
}

interface Meta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Teto do pacote de histórico enviado a quem entra (imagens dominam o tamanho). */
const HISTORY_BUDGET_BYTES = 8 * 1024 * 1024;

let current: { meta: Meta; dir: string } | null = null;

function rootDir(): string {
  return join(app.getPath('userData'), 'conversations');
}

function conversationDir(id: string): string {
  return join(rootDir(), id);
}

// ---------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------

export function listConversations(): ConversationSummary[] {
  const root = rootDir();
  if (!existsSync(root)) return [];

  const summaries: ConversationSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const summary = summarize(entry.name);
    if (summary) summaries.push(summary);
  }
  // Mais recente primeiro: é o que a pessoa quase sempre quer continuar.
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function summarize(id: string): ConversationSummary | null {
  try {
    const meta = readMeta(id);
    if (!meta) return null;
    return {
      ...meta,
      messageCount: countLines(join(conversationDir(id), 'messages.jsonl')),
      attachmentBytes: directorySize(join(conversationDir(id), 'attachments')),
    };
  } catch {
    return null;
  }
}

/** Abre uma conversa existente ou cria uma nova. */
export function openConversation(options: { id?: string; name?: string }): ConversationSummary {
  const id = options.id && existsSync(conversationDir(options.id)) ? options.id : randomUUID();
  const dir = conversationDir(id);
  mkdirSync(join(dir, 'attachments'), { recursive: true });

  const meta: Meta = readMeta(id) ?? {
    id,
    name: options.name?.trim() || defaultName(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (options.name?.trim()) meta.name = options.name.trim();

  current = { meta, dir };
  writeMeta(meta);

  return summarize(id) ?? { ...meta, messageCount: 0, attachmentBytes: 0 };
}

export function closeConversation(): void {
  current = null;
}

export function currentConversationId(): string | null {
  return current?.meta.id ?? null;
}

export function deleteConversation(id: string): void {
  if (current?.meta.id === id) current = null;
  rmSync(conversationDir(id), { recursive: true, force: true });
}

/** Apaga as mensagens mas mantém a conversa (e o nome dela). */
export function clearMessages(id: string): void {
  const dir = conversationDir(id);
  if (!existsSync(dir)) return;
  writeFileSync(join(dir, 'messages.jsonl'), '', 'utf-8');
  rmSync(join(dir, 'attachments'), { recursive: true, force: true });
  mkdirSync(join(dir, 'attachments'), { recursive: true });
}

/**
 * Descarta conversas que ninguém abre há muito tempo. A conversa em uso nunca
 * é candidata, mesmo que a data de atualização esteja velha.
 *
 * Devolve os nomes das que saíram, para poder registrar o que aconteceu.
 */
export function pruneConversations(retentionDays: RetentionDays): string[] {
  if (retentionDays < 0) return [];

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const conversation of listConversations()) {
    if (conversation.id === current?.meta.id) continue;
    if (conversation.updatedAt >= cutoff) continue;
    deleteConversation(conversation.id);
    removed.push(conversation.name);
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

/**
 * Grava a mensagem. Se vier imagem, o base64 é salvo como arquivo e a mensagem
 * guarda só o descritor — a versão devolvida mantém o `dataUrl` para o host
 * exibir na hora, sem reler do disco.
 */
export function appendMessage(message: ChatMessage): ChatMessage {
  if (!current) return message;

  let stored = message;
  if (message.attachment?.dataUrl) {
    const saved = saveAttachment(message.attachment);
    // No disco fica sem o base64; em memória segue com ele.
    stored = { ...message, attachment: { ...saved } };
  }

  try {
    appendFileSync(join(current.dir, 'messages.jsonl'), `${JSON.stringify(stored)}\n`, 'utf-8');
    current.meta.updatedAt = Date.now();
    writeMeta(current.meta);
  } catch (error) {
    console.error('[only] não deu para salvar a mensagem', error);
  }

  return message;
}

/**
 * Últimas mensagens para quem acabou de entrar. As imagens entram embutidas do
 * mais novo para o mais antigo até estourar o orçamento — assim uma conversa
 * cheia de fotos não vira um pacote de 200 MB no `join`.
 */
export function recentMessages(limit: number): ChatMessage[] {
  if (!current || limit <= 0) return [];

  const messages = readAllMessages().slice(-limit);
  let budget = HISTORY_BUDGET_BYTES;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const attachment = messages[index].attachment;
    if (!attachment) continue;

    if (attachment.size > budget) {
      // Sem espaço: vai o descritor, e o cliente pede a imagem se quiser ver.
      messages[index] = { ...messages[index], attachment: { ...attachment, dataUrl: undefined } };
      continue;
    }

    const dataUrl = readAttachment(attachment);
    if (dataUrl) {
      budget -= attachment.size;
      messages[index] = { ...messages[index], attachment: { ...attachment, dataUrl } };
    }
  }

  return messages;
}

/** Imagem cheia de uma mensagem específica, para carregar sob demanda. */
export function attachmentDataUrl(messageId: string): string | null {
  if (!current) return null;
  const message = readAllMessages().find((entry) => entry.id === messageId);
  return message?.attachment ? readAttachment(message.attachment) : null;
}

/**
 * Aplica a retenção: descarta mensagens antigas e as imagens que ficaram sem
 * dono. Devolve quantas mensagens saíram.
 */
export function pruneMessages(retentionDays: RetentionDays): number {
  if (!current || retentionDays < 0) return 0;

  const messages = readAllMessages();
  if (retentionDays === 0) {
    // "Não salvar" também significa não deixar rastro do que já foi salvo.
    clearMessages(current.meta.id);
    return messages.length;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const kept = messages.filter((message) => message.ts >= cutoff);
  if (kept.length === messages.length) return 0;

  try {
    writeFileSync(
      join(current.dir, 'messages.jsonl'),
      kept.map((message) => `${JSON.stringify(message)}\n`).join(''),
      'utf-8',
    );
    removeOrphanAttachments(kept);
  } catch (error) {
    console.error('[only] não deu para aplicar a retenção', error);
    return 0;
  }

  return messages.length - kept.length;
}

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

function readAllMessages(): ChatMessage[] {
  if (!current) return [];
  try {
    const raw = readFileSync(join(current.dir, 'messages.jsonl'), 'utf-8');
    const messages: ChatMessage[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line) as ChatMessage);
      } catch {
        // Linha truncada (queda de energia no meio de um append): ignora.
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function saveAttachment(attachment: Attachment): Attachment {
  const { dataUrl, ...descriptor } = attachment;
  if (!current || !dataUrl) return descriptor;

  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const buffer = Buffer.from(base64, 'base64');
  try {
    writeFileSync(join(current.dir, 'attachments', fileName(descriptor)), buffer);
  } catch (error) {
    console.error('[only] não deu para salvar a imagem', error);
  }
  return { ...descriptor, size: buffer.byteLength };
}

function readAttachment(attachment: Attachment): string | null {
  if (!current) return null;
  try {
    const buffer = readFileSync(join(current.dir, 'attachments', fileName(attachment)));
    return `data:${attachment.mimeType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

function fileName(attachment: Pick<Attachment, 'id' | 'mimeType'>): string {
  const extension = attachment.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  return `${attachment.id}.${extension}`;
}

function removeOrphanAttachments(kept: ChatMessage[]): void {
  if (!current) return;
  const alive = new Set(
    kept.filter((message) => message.attachment).map((message) => fileName(message.attachment!)),
  );

  const dir = join(current.dir, 'attachments');
  for (const entry of readdirSync(dir)) {
    if (!alive.has(entry)) rmSync(join(dir, entry), { force: true });
  }
}

function readMeta(id: string): Meta | null {
  try {
    return JSON.parse(readFileSync(join(conversationDir(id), 'meta.json'), 'utf-8')) as Meta;
  } catch {
    return null;
  }
}

function writeMeta(meta: Meta): void {
  try {
    writeFileSync(join(conversationDir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  } catch (error) {
    console.error('[only] não deu para salvar os dados da conversa', error);
  }
}

function countLines(path: string): number {
  try {
    return readFileSync(path, 'utf-8').split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function directorySize(path: string): number {
  try {
    return readdirSync(path).reduce((total, entry) => total + statSync(join(path, entry)).size, 0);
  } catch {
    return 0;
  }
}

/** Nome inicial legível: "Conversa de 17/08, 21:40". */
function defaultName(): string {
  const now = new Date();
  const date = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Conversa de ${date}, ${time}`;
}
