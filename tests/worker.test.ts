import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Command, Result, ConversationSnapshot, Highlight, Database } from '../src/types';
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
    sidePanel: { setPanelBehavior: async () => undefined },
    runtime: {
      id: 'test-extension',
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
