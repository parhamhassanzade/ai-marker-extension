import type { Database, Notebook, NotebookOverview } from '../types';
import { isHighlight, isSnapshot } from './validation';

export interface NotebookBackup {
  formatVersion: 1;
  appVersion: string;
  exportedAt: string;
  database: Database;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit;
const date = (value: unknown) => text(value, 40) && Number.isFinite(Date.parse(value));
const unique = (values: string[]) => new Set(values).size === values.length;
function isOverview(value: unknown): value is NotebookOverview {
  return (
    record(value) &&
    text(value.summary, 10_000) &&
    Array.isArray(value.topics) &&
    value.topics.length <= 100 &&
    value.topics.every((v) => text(v, 1000)) &&
    Array.isArray(value.keyInsights) &&
    value.keyInsights.length <= 100 &&
    value.keyInsights.every((v) => record(v) && text(v.text, 50_000) && text(v.messageId, 300)) &&
    (value.kind === 'local' || value.kind === 'manual') &&
    date(value.generatedAt) &&
    text(value.sourceSignature, 100)
  );
}
function isNotebook(value: unknown): value is Notebook {
  if (
    !isSnapshot(value) ||
    !record(value) ||
    !text(value.id, 100) ||
    !value.id ||
    !text(value.conversationTitle, 1000) ||
    !date(value.createdAt) ||
    !date(value.updatedAt) ||
    (value.finishedAt !== undefined && !date(value.finishedAt)) ||
    (value.overview !== undefined && !isOverview(value.overview)) ||
    !Array.isArray(value.highlights) ||
    !value.highlights.every(isHighlight)
  )
    return false;
  const ids = new Set(value.messages.map((m) => m.id));
  return (
    unique(value.messages.map((m) => m.id)) &&
    unique(value.highlights.map((h) => h.id)) &&
    value.highlights.every(
      (h) =>
        ids.has(h.messageId) &&
        h.platform === value.platform &&
        h.conversationId === value.conversationId,
    )
  );
}
export function isDatabase(value: unknown): value is Database {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.notebooks) ||
    !value.notebooks.every(isNotebook) ||
    !unique(value.notebooks.map((n) => n.id)) ||
    !record(value.activeByConversation) ||
    !Array.isArray(value.pausedConversations) ||
    !value.pausedConversations.every((key) => text(key, 1000))
  )
    return false;
  const notebooks: Notebook[] = value.notebooks;
  return Object.entries(value.activeByConversation).every(
    ([key, id]) =>
      typeof id === 'string' &&
      notebooks.some(
        (n) => n.id === id && !n.finishedAt && `${n.platform}:${n.conversationId}` === key,
      ),
  );
}

// A pure file-format codec, not an import command. Applying an archive (preview,
// duplicate policy, pausing, and a worker-owned transaction) is a separate feature.
// Message.contentVersion and the complete AST/mappings are retained verbatim.
export function parseNotebookBackup(json: string): NotebookBackup {
  if (json.length > 64 * 1024 * 1024 || new Blob([json]).size > 64 * 1024 * 1024)
    throw new Error('Notebook backup exceeds the 64 MB file limit.');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Notebook backup is not valid JSON.');
  }
  if (
    !record(value) ||
    value.formatVersion !== 1 ||
    !text(value.appVersion, 100) ||
    !value.appVersion ||
    !date(value.exportedAt) ||
    !isDatabase(value.database)
  )
    throw new Error('Notebook backup has an unsupported format or invalid content.');
  return value as unknown as NotebookBackup;
}
export function serializeNotebookBackup(
  database: Database,
  appVersion: string,
  notebookId?: string,
  exportedAt = new Date().toISOString(),
): string {
  let selected = database;
  if (notebookId !== undefined) {
    const notebook = database.notebooks.find((n) => n.id === notebookId);
    if (!notebook) throw new Error('Notebook no longer exists.');
    const key = `${notebook.platform}:${notebook.conversationId}`;
    selected = {
      version: 1,
      notebooks: [notebook],
      activeByConversation:
        database.activeByConversation[key] === notebookId ? { [key]: notebookId } : {},
      pausedConversations: database.pausedConversations.filter((item) => item === key),
    };
  }
  const json = JSON.stringify({
    formatVersion: 1,
    appVersion,
    exportedAt,
    database: selected,
  } satisfies NotebookBackup);
  parseNotebookBackup(json);
  return json;
}
