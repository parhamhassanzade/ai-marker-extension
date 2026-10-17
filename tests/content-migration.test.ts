import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readDatabase, writeDatabase, closeDatabase } from '../src/storage/indexedDB';
import { transition, emptyDatabase } from '../src/storage/repository';
import { serializeNotebookBackup, parseNotebookBackup } from '../src/storage/backup';
import { extractMessages } from '../src/content/chatgpt/extractor';
import { resolveAnchor } from '../src/content/highlighter';
import { createNotebookPdf } from '../src/pdf/notebookExporter';
import type { Database, ConversationSnapshot } from '../src/types';

const legacy = (): Database =>
  JSON.parse(readFileSync('tests/fixtures/pre-rich-database.json', 'utf8'));
const richSnapshot = (): ConversationSnapshot => {
  document.documentElement.innerHTML = readFileSync(
    'tests/fixtures/chatgpt-rich-persian.html',
    'utf8',
  );
  return {
    platform: 'ChatGPT',
    conversationId: 'rich-chat',
    title: 'Study',
    website: 'https://chatgpt.com/c/rich-chat',
    messages: extractMessages(),
  };
};
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(async () => {
  await closeDatabase();
  vi.unstubAllGlobals();
});

it('loads a pre-change database unchanged, renders plain PDF, and preserves anchors without recapture', async () => {
  const old = legacy();
  await writeDatabase(old);
  await closeDatabase();
  const loaded = (await readDatabase())!;
  expect(loaded).toEqual(old);
  const notebook = loaded.notebooks[0]!;
  expect(notebook.messages[1]!.content).toBeUndefined();
  expect(resolveAnchor(notebook.messages[1]!.text, notebook.highlights[0]!)).toBe(0);
  expect(createNotebookPdf(notebook).getNumberOfPages()).toBeGreaterThan(0);
  expect(transition(loaded, { type: 'list' })).toEqual(old);
});

it('never upgrades existing legacy messages during sync, activation, or source annotation', () => {
  const old = legacy();
  const source = richSnapshot();
  const oldNotebook = old.notebooks[0]!;
  const text = oldNotebook.messages[1]!.text;
  document.body.innerHTML = `<main><div data-message-author-role="assistant" data-message-id="legacy-a"><pre>${text}</pre></div></main>`;
  const incoming = {
    ...source,
    conversationId: oldNotebook.conversationId,
    website: oldNotebook.website,
    messages: extractMessages(),
  };
  expect(incoming.messages[0]!.contentVersion).toBe(1);
  for (const type of ['sync', 'activate'] as const) {
    const next = transition(old, { type, snapshot: incoming });
    expect(next.notebooks[0]!.messages[1]!.content).toBeUndefined();
    expect(next.notebooks[0]!.messages[1]).toEqual(oldNotebook.messages[1]);
    expect(next.notebooks[0]!.highlights).toEqual(oldNotebook.highlights);
  }
  const next = transition(old, {
    type: 'sourceHighlight',
    snapshot: incoming,
    highlight: oldNotebook.highlights[0]!,
  });
  expect(next.notebooks[0]!.messages[1]!.contentVersion).toBeUndefined();
});

it('retains old assistant text and representation if a rich snapshot has edited or regenerated it', () => {
  const db = legacy();
  document.body.innerHTML =
    '<main><div data-message-author-role="assistant" data-message-id="legacy-a"><strong>Regenerated answer</strong></div></main>';
  const next = transition(db, {
    type: 'sync',
    snapshot: {
      platform: 'ChatGPT',
      conversationId: 'legacy-chat',
      website: 'https://chatgpt.com/c/legacy-chat',
      title: 'Study',
      messages: extractMessages(),
    },
  });
  expect(next.notebooks[0]!.messages).toEqual(db.notebooks[0]!.messages);
  expect(next.notebooks[0]!.highlights).toEqual(db.notebooks[0]!.highlights);
});

it('persists rich captures and streaming updates through the existing atomic record format', async () => {
  const snapshot = richSnapshot();
  const db = transition(emptyDatabase(), { type: 'activate', snapshot });
  await writeDatabase(db);
  await closeDatabase();
  expect(await readDatabase()).toEqual(db);
  document.querySelector('.prose p')!.append(' Streaming addition.');
  const next = transition(db, {
    type: 'sync',
    snapshot: { ...snapshot, messages: extractMessages() },
  });
  expect(next.notebooks[0]!.messages[1]!.text).toContain('Streaming addition.');
  expect(next.notebooks[0]!.messages[1]!.contentVersion).toBe(1);
  await writeDatabase(next, db);
  expect(await readDatabase()).toEqual(next);
});

it('does not discard unchanged rich content if an older content script returns a plain snapshot', () => {
  const snapshot = richSnapshot();
  const db = transition(emptyDatabase(), { type: 'activate', snapshot });
  const plain = snapshot.messages.map(({ contentVersion: _version, content: _content, ...m }) => m);
  expect(transition(db, { type: 'sync', snapshot: { ...snapshot, messages: plain } })).toEqual(db);
  const edited = structuredClone(plain);
  edited[1]!.text = 'Edited by an older script';
  const next = transition(db, { type: 'sync', snapshot: { ...snapshot, messages: edited } });
  expect(next.notebooks[0]!.messages[1]!.content).toBeUndefined();
});

it('round-trips structured and pre-change archives through the versioned JSON backup codec', () => {
  const rich = transition(emptyDatabase(), { type: 'activate', snapshot: richSnapshot() });
  for (const db of [legacy(), rich]) {
    const json = serializeNotebookBackup(db, '3.0.3', undefined, '2026-10-17T12:00:00.000Z');
    const backup = parseNotebookBackup(json);
    expect(backup.formatVersion).toBe(1);
    expect(backup.appVersion).toBe('3.0.3');
    expect(backup.database).toEqual(db);
  }
  expect(
    parseNotebookBackup(serializeNotebookBackup(rich, '3.0.3')).database.notebooks[0]!.messages[1]!
      .contentVersion,
  ).toBe(1);
});

it('exports one notebook with only its lifecycle references and leaves the original untouched', () => {
  const db = legacy();
  const rich = transition(emptyDatabase(), { type: 'activate', snapshot: richSnapshot() });
  db.notebooks.push(...rich.notebooks);
  Object.assign(db.activeByConversation, rich.activeByConversation);
  const before = structuredClone(db);
  const selected = parseNotebookBackup(
    serializeNotebookBackup(db, '3.0.3', 'legacy-notebook'),
  ).database;
  expect(selected).toEqual(legacy());
  expect(db).toEqual(before);
  expect(() => serializeNotebookBackup(db, '3.0.3', 'missing')).toThrow('no longer exists');
});

it('rejects corrupt backup content, unknown schema versions and orphaned highlights without touching storage', async () => {
  const db = legacy();
  await writeDatabase(db);
  const backup = JSON.parse(serializeNotebookBackup(db, '3.0.3'));
  expect(() => parseNotebookBackup('not json')).toThrow('valid JSON');
  expect(() => parseNotebookBackup(JSON.stringify({ ...backup, formatVersion: 2 }))).toThrow(
    'unsupported',
  );
  backup.database.notebooks[0].highlights[0].messageId = 'missing';
  expect(() => parseNotebookBackup(JSON.stringify(backup))).toThrow('invalid content');
  const rich = transition(emptyDatabase(), { type: 'activate', snapshot: richSnapshot() });
  const json = JSON.parse(serializeNotebookBackup(rich, '3.0.3'));
  json.database.notebooks[0].messages[1].contentVersion = 2;
  expect(() => parseNotebookBackup(JSON.stringify(json))).toThrow('invalid content');
  delete backup.database;
  expect(() => parseNotebookBackup(JSON.stringify(backup))).toThrow('invalid content');
  expect(await readDatabase()).toEqual(db);
});

it('rejects oversized backup files before JSON parsing', () => {
  expect(() => parseNotebookBackup('x'.repeat(64 * 1024 * 1024 + 1))).toThrow('64 MB');
});
