import { extension } from '../browser/api';
import { SURFACE_PREFERENCE_KEY, surfacePreference } from '../browser/surfacePreference';
import { configureNotebookSurface } from './notebookSurface';
import { matchesHighlightSource } from './sourceAuthorization';
import { isCommand } from '../storage/validation';
import { STORAGE_KEY } from '../storage/storage';
import { emptyDatabase, transition } from '../storage/repository';
import { readDatabase, writeDatabase } from '../storage/indexedDB';
import type { Command, Database, Result } from '../types';
import {
  isSupportCommand,
  SUPPORT_STORAGE_KEY,
  supportState,
  type SupportCommand,
  type SupportResult,
} from '../storage/support';
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
async function executeSupport(command: SupportCommand): Promise<SupportResult> {
  try {
    const saved = (await extension.storage.local.get(SUPPORT_STORAGE_KEY))[SUPPORT_STORAGE_KEY];
    const state = supportState(saved);
    if (command.type === 'recordPdfExport') {
      const db = await loadDatabase();
      const notebook = db.notebooks.find((n) => n.id === command.notebookId);
      if (!notebook?.messages.some((m) => m.text.trim()))
        throw new Error('Empty or missing notebooks do not count as PDF exports.');
      state.successfulPdfExports = Math.min(
        Number.MAX_SAFE_INTEGER,
        state.successfulPdfExports + 1,
      );
    }
    if (command.type === 'dismissSupport') state.dismissed = true;
    if (command.type !== 'getSupportState')
      await extension.storage.local.set({ [SUPPORT_STORAGE_KEY]: state });
    return { ok: true, data: state };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save the support preference.',
    };
  }
}
extension.runtime.onMessage.addListener((command: unknown, sender, respond) => {
  if (sender.id !== extension.runtime.id) return false;
  if (
    typeof command === 'object' &&
    command &&
    'type' in command &&
    (command.type === 'setNotebookSurface' || command.type === 'openNotebookSurface')
  ) {
    if (!sender.url?.startsWith(extension.runtime.getURL('/')) || !notebookSurfaces) {
      respond({ ok: false, error: 'Open notebook settings in the Chromium notebook.' });
      return false;
    }
    if (command.type === 'setNotebookSurface') {
      if (
        !('value' in command) ||
        typeof command.value !== 'string' ||
        !['auto', 'side-panel', 'window'].includes(command.value)
      ) {
        respond({ ok: false, error: 'Invalid notebook surface.' });
        return false;
      }
      const value = surfacePreference(command.value);
      const task = queue.then(async () => {
        await extension.storage.local.set({ [SURFACE_PREFERENCE_KEY]: value });
        notebookSurfaces.setPreference(value);
        return { ok: true };
      });
      queue = task.catch(() => undefined);
      void task.then(respond, (error: Error) => respond({ ok: false, error: error.message }));
    } else {
      if (
        !('tabId' in command) ||
        !('windowId' in command) ||
        !Number.isSafeInteger(command.tabId) ||
        !Number.isSafeInteger(command.windowId) ||
        Number(command.tabId) < 0 ||
        Number(command.windowId) < 0
      ) {
        respond({ ok: false, error: 'Invalid source tab.' });
        return false;
      }
      // Launch outside the storage queue to retain the user's click gesture.
      void notebookSurfaces
        .open({ id: command.tabId, windowId: command.windowId } as chrome.tabs.Tab)
        .then(
          (surface) => respond({ ok: true, surface }),
          (error: Error) => respond({ ok: false, error: error.message }),
        );
    }
    return true;
  }
  if (isSupportCommand(command)) {
    // Only extension pages may record exports or dismiss the note. Content
    // scripts must not be able to increment this counter or change preferences.
    if (!sender.url?.startsWith(extension.runtime.getURL('/'))) {
      respond({
        ok: false,
        error: 'Support preferences are available in the notebook.',
      } satisfies SupportResult);
      return false;
    }
    const task = queue.then(() => executeSupport(command));
    queue = task.catch(() => undefined);
    void task.then(respond);
    return true;
  }
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
    (command.type === 'notebooksChanged' ||
      command.type === 'captureError' ||
      command.type === 'probeNotebookVisibility')
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
const notebookSurfaces = configureNotebookSurface();
