import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import type { Command, Result, ConversationSnapshot, Highlight, Database } from '../src/types';
import { SUPPORT_STORAGE_KEY, type SupportResult } from '../src/storage/support';
let listener: (
  command: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (result: Result) => void,
) => boolean;
let local: Record<string, unknown>;
let database: typeof import('../src/storage/indexedDB');
const snapshot: ConversationSnapshot = {
  platform: 'ChatGPT',
  conversationId: 'c',
  title: 'Research',
  website: 'https://chatgpt.com/c/c',
  messages: [{ id: 'a', role: 'assistant', text: 'insight' }],
};
const highlight: Highlight = {
  id: 'h',
  platform: 'ChatGPT',
  conversationId: 'c',
  website: snapshot.website,
  messageId: 'a',
  text: 'insight',
  note: '',
  color: 'yellow',
  createdAt: '2026-01-01T00:00:00Z',
  anchor: { start: 0, end: 7, prefix: '', suffix: '' },
};
const send = (command: Command | unknown) =>
  new Promise<Result>((resolve) =>
    listener(
      command,
      { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' },
      resolve,
    ),
  );
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  local = {};
  vi.stubGlobal('chrome', {
    tabs: { query: async () => [] },
    action: { onClicked: { addListener: () => undefined } },
    sidePanel: { setPanelBehavior: async () => undefined },
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ side_panel: {} }),
      getURL: (path: string) => `chrome-extension://test-extension${path}`,
      sendMessage: async () => ({ ok: true }),
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
    storage: {
      local: {
        get: async () => structuredClone(local),
        set: async (value: Record<string, unknown>) => {
          Object.assign(local, value);
        },
        remove: async (key: string) => {
          delete local[key];
        },
        setAccessLevel: async () => undefined,
      },
    },
  });
  database = await import('../src/storage/indexedDB');
  await import('../src/background/serviceWorker');
});
afterEach(async () => {
  await database.closeDatabase();
});
it('serializes concurrent clients into IndexedDB without losing annotations', async () => {
  const activated = await send({ type: 'activate', snapshot });
  if (!activated.ok) throw new Error(activated.error);
  const id = activated.data.notebooks[0]!.id;
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      send({ type: 'annotate', id, highlight: { ...highlight, id: `h${i}` } }),
    ),
  );
  expect(results.every((r) => r.ok)).toBe(true);
  expect((await database.readDatabase())?.notebooks[0]?.highlights).toHaveLength(20);
});
it('reports transaction failure and preserves the committed archive', async () => {
  await send({ type: 'activate', snapshot });
  const previous = await database.readDatabase();
  vi.spyOn(database, 'writeDatabase').mockRejectedValueOnce(new Error('QuotaExceededError'));
  const failed = await send({ type: 'rename', id: previous!.notebooks[0]!.id, title: 'Changed' });
  expect(failed.ok).toBe(false);
  expect(await database.readDatabase()).toEqual(previous);
  expect((await send({ type: 'list' })).ok).toBe(true);
});
it('migrates legacy data only after a durable IndexedDB commit', async () => {
  const { emptyDatabase, transition } = await import('../src/storage/repository');
  local['aiMarker.v1'] = transition(emptyDatabase(), { type: 'activate', snapshot });
  await send({ type: 'list' });
  expect((await database.readDatabase())?.notebooks).toHaveLength(1);
  expect(local['aiMarker.v1']).toBeUndefined();
  expect((await database.readDatabase())?.activeByConversation).toEqual({});
});
it('rejects malformed payloads and passages attached to another conversation', async () => {
  const active = await send({ type: 'activate', snapshot });
  if (!active.ok) throw new Error(active.error);
  const id = active.data.notebooks[0]!.id;
  expect(
    (await send({ type: 'annotate', id, highlight: { ...highlight, color: 'invalid' } })).ok,
  ).toBe(false);
  expect(
    (await send({ type: 'annotate', id, highlight: { ...highlight, conversationId: 'different' } }))
      .ok,
  ).toBe(false);
  expect(
    (await send({ type: 'sync', snapshot: { ...snapshot, website: 'javascript:alert(1)' } })).ok,
  ).toBe(false);
  expect((await database.readDatabase())?.notebooks[0]?.highlights).toHaveLength(0);
});
it('persists conversations larger than Chrome Storage local quota across connection restarts', async () => {
  await send({ type: 'activate', snapshot });
  const db = (await database.readDatabase())!;
  db.notebooks[0]!.messages = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`,
    role: 'assistant',
    text: 'x'.repeat(1_000_000),
  }));
  await database.writeDatabase(db as Database);
  await database.closeDatabase();
  expect(
    (await database.readDatabase())?.notebooks[0]?.messages.reduce(
      (total, m) => total + m.text.length,
      0,
    ),
  ).toBe(12_000_000);
});

it('saves a highlight after navigating to an old chat without reloading the document', async () => {
  const get = vi.fn().mockResolvedValue({ id: 12, url: snapshot.website });
  Object.assign(chrome.tabs, { get });
  const result = await new Promise<Result>((resolve) =>
    listener(
      { type: 'sourceHighlight', snapshot, highlight },
      {
        id: 'test-extension',
        url: 'https://chatgpt.com/c/initial',
        frameId: 0,
        tab: { id: 12 } as chrome.tabs.Tab,
      },
      resolve,
    ),
  );
  expect(result.ok).toBe(true);
  expect(get).toHaveBeenCalledWith(12);
  expect((await database.readDatabase())?.notebooks[0]?.highlights).toEqual([highlight]);
});
it('rejects stale selections after the current tab moves to a different conversation', async () => {
  Object.assign(chrome.tabs, {
    get: vi.fn().mockResolvedValue({ id: 12, url: 'https://chatgpt.com/c/different' }),
  });
  const result = await new Promise<Result>((resolve) =>
    listener(
      { type: 'sourceHighlight', snapshot, highlight },
      {
        id: 'test-extension',
        url: snapshot.website,
        frameId: 0,
        tab: { id: 12 } as chrome.tabs.Tab,
      },
      resolve,
    ),
  );
  expect(result.ok).toBe(false);
  expect(await database.readDatabase()).toBeUndefined();
});

it('migrates a real pre-rich fixture without changing messages, highlights, or anchors', async () => {
  const original = JSON.parse(
    readFileSync('tests/fixtures/pre-rich-database.json', 'utf8'),
  ) as Database;
  local['aiMarker.v1'] = structuredClone(original);
  const result = await send({ type: 'list' });
  expect(result.ok).toBe(true);
  const migrated = (await database.readDatabase())!;
  expect(migrated.notebooks).toEqual(original.notebooks);
  expect(migrated.activeByConversation).toEqual({});
  expect(migrated.pausedConversations).toContain('ChatGPT:legacy-chat');
  expect(local['aiMarker.v1']).toBeUndefined();
});

it('preserves both archive and lifecycle metadata when a rich-content commit fails', async () => {
  await send({ type: 'activate', snapshot });
  const original = (await database.readDatabase())!;
  const rich: ConversationSnapshot = {
    ...snapshot,
    messages: [
      {
        ...snapshot.messages[0]!,
        contentVersion: 1,
        content: {
          blocks: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'insight',
                  marks: { bold: true },
                  mappings: [{ start: 0, end: 7, textStart: 0, textEnd: 7 }],
                },
              ],
            },
          ],
          gaps: [],
        },
      },
    ],
  };
  vi.spyOn(database, 'writeDatabase').mockRejectedValueOnce(new Error('Transaction aborted'));
  expect((await send({ type: 'create', snapshot: rich })).ok).toBe(false);
  expect(await database.readDatabase()).toEqual(original);
  expect((await send({ type: 'create', snapshot: rich })).ok).toBe(true);
  const saved = (await database.readDatabase())!;
  expect(saved.notebooks.at(-1)!.messages[0]!.contentVersion).toBe(1);
  const invalid = structuredClone(rich);
  invalid.messages[0]!.content!.gaps.push({ start: 0, end: 1 });
  expect((await send({ type: 'create', snapshot: invalid })).ok).toBe(false);
  expect(await database.readDatabase()).toEqual(saved);
});

it('keeps a pre-rich legacy archive available when its migration transaction fails', async () => {
  const original = JSON.parse(
    readFileSync('tests/fixtures/pre-rich-database.json', 'utf8'),
  ) as Database;
  local['aiMarker.v1'] = structuredClone(original);
  vi.spyOn(database, 'writeDatabase').mockRejectedValueOnce(new Error('Migration aborted'));
  expect((await send({ type: 'list' })).ok).toBe(false);
  expect(await database.readDatabase()).toBeUndefined();
  expect(local['aiMarker.v1']).toEqual(original);
  expect((await send({ type: 'list' })).ok).toBe(true);
  expect((await database.readDatabase())!.notebooks).toEqual(original.notebooks);
});

const supportRequest = async (command: unknown) =>
  (await send(command)) as unknown as SupportResult;
it('counts successful export notifications in order and permanently retains dismissal', async () => {
  const created = await send({ type: 'activate', snapshot });
  if (!created.ok) throw new Error(created.error);
  const notebookId = created.data.notebooks[0]!.id;
  expect(await supportRequest({ type: 'getSupportState' })).toEqual({
    ok: true,
    data: { successfulPdfExports: 0, dismissed: false },
  });
  const counts = await Promise.all(
    Array.from({ length: 3 }, () => supportRequest({ type: 'recordPdfExport', notebookId })),
  );
  expect(counts.map((r) => (r.ok ? r.data.successfulPdfExports : -1))).toEqual([1, 2, 3]);
  await Promise.all([
    supportRequest({ type: 'dismissSupport' }),
    supportRequest({ type: 'recordPdfExport', notebookId }),
  ]);
  expect(local[SUPPORT_STORAGE_KEY]).toEqual({ successfulPdfExports: 4, dismissed: true });
  // Reload the worker module, retaining both browser stores, as on an update.
  await database.closeDatabase();
  vi.resetModules();
  database = await import('../src/storage/indexedDB');
  await import('../src/background/serviceWorker');
  expect(await supportRequest({ type: 'getSupportState' })).toEqual({
    ok: true,
    data: { successfulPdfExports: 4, dismissed: true },
  });
  await supportRequest({ type: 'recordPdfExport', notebookId });
  expect(local[SUPPORT_STORAGE_KEY]).toEqual({ successfulPdfExports: 5, dismissed: true });
});
it('never counts empty/missing notebooks or malformed export notifications', async () => {
  const created = await send({ type: 'activate', snapshot: { ...snapshot, messages: [] } });
  if (!created.ok) throw new Error(created.error);
  for (const notebookId of [created.data.notebooks[0]!.id, 'missing'])
    expect((await supportRequest({ type: 'recordPdfExport', notebookId })).ok).toBe(false);
  expect((await supportRequest({ type: 'recordPdfExport', notebookId: '' })).ok).toBe(false);
  expect(local[SUPPORT_STORAGE_KEY]).toBeUndefined();
});
it('does not lose preferences or poison the command queue when local storage fails', async () => {
  local[SUPPORT_STORAGE_KEY] = { successfulPdfExports: 3, dismissed: false };
  const original = structuredClone(local[SUPPORT_STORAGE_KEY]);
  const originalSet = chrome.storage.local.set;
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('Storage full'));
  expect((await supportRequest({ type: 'dismissSupport' })).ok).toBe(false);
  expect(local[SUPPORT_STORAGE_KEY]).toEqual(original);
  chrome.storage.local.set = originalSet;
  expect((await supportRequest({ type: 'dismissSupport' })).ok).toBe(true);
  expect(local[SUPPORT_STORAGE_KEY]).toEqual({ successfulPdfExports: 3, dismissed: true });
});
it('rejects support commands from content scripts even with the extension sender ID', async () => {
  const result = await new Promise<unknown>((resolve) =>
    listener(
      { type: 'dismissSupport' },
      { id: 'test-extension', url: 'https://chatgpt.com/c/c', tab: { id: 12 } as chrome.tabs.Tab },
      resolve,
    ),
  );
  expect(result).toMatchObject({ ok: false });
  expect(local[SUPPORT_STORAGE_KEY]).toBeUndefined();
});
it('persists and validates notebook surface overrides without modifying notebooks', async () => {
  expect((await send({ type: 'setNotebookSurface', value: 'window' })).ok).toBe(true);
  expect(local['aiNotebook.surface']).toBe('window');
  expect((await send({ type: 'setNotebookSurface', value: 'invalid' })).ok).toBe(false);
  expect(local['aiNotebook.surface']).toBe('window');
  expect(await database.readDatabase()).toBeUndefined();
});
it('rejects surface preference changes from content scripts', () => {
  const respond = vi.fn();
  listener(
    { type: 'setNotebookSurface', value: 'window' },
    { id: 'test-extension', url: 'https://chatgpt.com/c/c', tab: { id: 1 } as chrome.tabs.Tab },
    respond,
  );
  expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  expect(local['aiNotebook.surface']).toBeUndefined();
});
