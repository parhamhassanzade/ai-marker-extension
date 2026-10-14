import { extension } from '../browser/api';
import { configureNotebookSurface } from './notebookSurface';
import { matchesHighlightSource } from './sourceAuthorization';
import { isCommand } from '../storage/validation';
import { STORAGE_KEY } from '../storage/storage';
import { emptyDatabase, transition } from '../storage/repository';
import { readDatabase, writeDatabase } from '../storage/indexedDB';
import type { Command, Database, Result } from '../types';
let queue: Promise<unknown> = Promise.resolve();
async function loadDatabase(): Promise<Database> {
  const existing = await readDatabase();
  if (existing) return existing;
  const legacy = (await extension.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
    Database | undefined;
  if (legacy && (legacy.version !== 1 || !Array.isArray(legacy.notebooks)))
    throw new Error(
      'The existing AI Marker archive could not be migrated. Its data has been preserved.',
    );
  const initial = legacy ?? emptyDatabase();
  if (legacy) {
    // An upgrade preserves the archive but requires fresh Notebook Mode consent.
    initial.pausedConversations = [
      ...new Set([...initial.pausedConversations, ...Object.keys(initial.activeByConversation)]),
    ];
    initial.activeByConversation = {};
  }
  initial.notebooks.forEach((n) => {
    n.conversationTitle ??= n.title;
  });
  await writeDatabase(initial);
  // Delete the old large blob only after the IndexedDB transaction is durable.
  if (legacy) await extension.storage.local.remove(STORAGE_KEY);
  await extension.storage.local.set({ 'aiNotebook.migrated': true });
  return initial;
}
async function notifyViews() {
  await extension.runtime.sendMessage({ type: 'notebooksChanged' }).catch(() => undefined);
  const tabs = await extension.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) => extension.tabs.sendMessage(tab.id!, { type: 'notebooksChanged' })),
  );
}
async function execute(command: Command): Promise<Result> {
  try {
    const db = await loadDatabase();
    if (db.version !== 1 || !Array.isArray(db.notebooks))
      throw new Error('Unsupported notebook database. Your stored data has been preserved.');
    const next = transition(db, command);
    if (command.type !== 'list' && JSON.stringify(db) !== JSON.stringify(next)) {
      await writeDatabase(next, db);
      await notifyViews().catch((error) =>
        console.warn('[AI Notebook] View notification failed', error),
      );
    }
    return { ok: true, data: next };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Notebook could not be saved.',
    };
  }
}
extension.runtime.onMessage.addListener((command: unknown, sender, respond) => {
  if (sender.id !== extension.runtime.id) return false;
  if (
    typeof command === 'object' &&
    command &&
    'type' in command &&
    command.type === 'capabilities'
  ) {
    respond({ sourceHighlights: true, knowledgeNotebook: true });
    return false;
  }
  // These are broadcasts, not storage commands. Do not race a view's response.
  if (
    typeof command === 'object' &&
    command &&
    'type' in command &&
    (command.type === 'notebooksChanged' || command.type === 'captureError')
  )
    return false;
  if (!isCommand(command)) {
    respond({ ok: false, error: 'Invalid notebook request.' } satisfies Result);
    return false;
  }
  if (
    sender.tab &&
    !sender.url?.startsWith(extension.runtime.getURL('/')) &&
    !['sync', 'list', 'sourceHighlight'].includes(command.type)
  ) {
    respond({
      ok: false,
      error: 'Notebook management is available in the side panel.',
    } satisfies Result);
    return false;
  }
  const task = queue.then(async (): Promise<Result> => {
    if (sender.tab && command.type === 'sourceHighlight') {
      try {
        if (sender.tab.id === undefined) throw new Error('Missing source tab');
        const tab = await extension.tabs.get(sender.tab.id);
        if (!matchesHighlightSource(command.snapshot, sender, tab.url))
          throw new Error('Source changed');
      } catch {
        return {
          ok: false,
          error:
            'The conversation changed before this highlight was saved. Select the sentence again in the current chat.',
        };
      }
    }
    return execute(command);
  });
  queue = task.catch(() => undefined);
  void task.then(respond);
  return true;
});
void extension.storage.local
  .setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(console.error);
configureNotebookSurface();
