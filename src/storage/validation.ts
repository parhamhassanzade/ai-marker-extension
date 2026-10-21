import type { Command, ConversationSnapshot, Highlight } from '../types';
import { isMessageContent } from '../content/model/validation';
import { platformOf } from '../platforms';
const platforms = new Set(['ChatGPT', 'Claude', 'Gemini', 'Perplexity']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isText = (value: unknown, limit: number) =>
  typeof value === 'string' && value.length <= limit;
export function isSnapshot(value: unknown): value is ConversationSnapshot {
  if (
    !isRecord(value) ||
    !platforms.has(String(value.platform)) ||
    !isText(value.conversationId, 300) ||
    !value.conversationId ||
    !isText(value.title, 1000) ||
    !isText(value.website, 3000) ||
    !Array.isArray(value.messages)
  )
    return false;
  if (platformOf(String(value.website)) !== value.platform) return false;
  return value.messages.every(
    (m) =>
      isRecord(m) &&
      isText(m.id, 300) &&
      (m.role === 'user' || m.role === 'assistant') &&
      isText(m.text, 2_000_000) &&
      ((m.contentVersion === undefined && m.content === undefined) ||
        (m.role === 'assistant' &&
          m.contentVersion === 1 &&
          isMessageContent(m.content, String(m.text)))) &&
      (m.timestamp === undefined ||
        (isText(m.timestamp, 40) && Number.isFinite(Date.parse(String(m.timestamp))))) &&
      (m.order === undefined || (Number.isInteger(m.order) && Number(m.order) >= 0)),
  );
}
const isTags = (value: unknown) =>
  Array.isArray(value) && value.length <= 20 && value.every((tag) => isText(tag, 50));
export function isHighlight(value: unknown): value is Highlight {
  if (!isRecord(value) || !isRecord(value.anchor)) return false;
  const a = value.anchor;
  return (
    isText(value.id, 100) &&
    !!value.id &&
    isText(value.messageId, 300) &&
    isText(value.conversationId, 300) &&
    platforms.has(String(value.platform)) &&
    isText(value.website, 3000) &&
    isText(value.text, 50_000) &&
    !!value.text &&
    isText(value.note, 5000) &&
    (value.tags === undefined || isTags(value.tags)) &&
    (value.bookmarked === undefined || typeof value.bookmarked === 'boolean') &&
    ['yellow', 'green', 'red'].includes(String(value.color)) &&
    isText(value.createdAt, 40) &&
    Number.isFinite(Date.parse(String(value.createdAt))) &&
    Number.isInteger(a.start) &&
    Number(a.start) >= 0 &&
    Number.isInteger(a.end) &&
    Number(a.end) === Number(a.start) + String(value.text).length &&
    isText(a.prefix, 40) &&
    isText(a.suffix, 40)
  );
}
export function isCommand(value: unknown): value is Command {
  if (!isRecord(value)) return false;
  if (value.type === 'list') return true;
  if (value.type === 'sourceHighlight')
    return isSnapshot(value.snapshot) && isHighlight(value.highlight);
  if (value.type === 'sync' || value.type === 'create' || value.type === 'activate') {
    if (!isSnapshot(value.snapshot)) return false;
    if (value.type === 'activate') return true;
    if (value.type === 'create') return value.title === undefined || isText(value.title, 200);
    return value.previousConversationId === undefined || isText(value.previousConversationId, 300);
  }
  if (!isText(value.id, 100) || !value.id) return false;
  if (value.type === 'updateAnnotation')
    return (
      isText(value.highlightId, 100) &&
      isText(value.note, 5000) &&
      isTags(value.tags) &&
      typeof value.bookmarked === 'boolean'
    );
  if (value.type === 'saveOverview')
    return (
      isText(value.summary, 10000) && value.kind === 'manual' && isText(value.sourceSignature, 100)
    );
  if (value.type === 'annotate') return isHighlight(value.highlight);
  if (value.type === 'updateNote')
    return isText(value.highlightId, 100) && isText(value.note, 5000);
  if (value.type === 'rename') return isText(value.title, 200);
  if (value.type === 'removeHighlight') return isText(value.highlightId, 100);
  return value.type === 'finish' || value.type === 'pause' || value.type === 'clear';
}
