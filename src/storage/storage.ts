import { extension, isExtensionContext } from '../browser/api';
import type { Command, ConversationSnapshot, Database, Highlight, Result } from '../types';
export const STORAGE_KEY = 'aiMarker.v1';
async function request(command: Command): Promise<Database> {
  if (!isExtensionContext())
    throw new Error('Open AI Notebook from the installed browser extension.');
  const result = await extension.runtime.sendMessage<Command, Result>(command);
  if (!result?.ok)
    throw new Error(
      result?.error ||
        'AI Notebook could not reach its background worker. Reload the extension and page.',
    );
  return result.data;
}
export const storage = {
  async saveSourceHighlight(snapshot: ConversationSnapshot, highlight: Highlight) {
    // Rebuilding an unpacked extension changes files immediately, but Chrome can
    // keep the old worker alive while injecting the new content script from disk.
    const capabilities = (await extension.runtime.sendMessage({ type: 'capabilities' })) as
      { sourceHighlights?: boolean } | undefined;
    if (!capabilities?.sourceHighlights)
      throw new Error(
        'AI Notebook needs an update reload. Reload AI Notebook on your browser’s extensions page, then reload this ChatGPT tab and select the sentence again.',
      );
    return request({ type: 'sourceHighlight', snapshot, highlight });
  },
  listNotebooks: () => request({ type: 'list' }),
  syncConversation: (snapshot: ConversationSnapshot, previousConversationId?: string) =>
    request({ type: 'sync', snapshot, previousConversationId }),
  activateNotebook: (snapshot: ConversationSnapshot) => request({ type: 'activate', snapshot }),
  pauseNotebook: (id: string) => request({ type: 'pause', id }),
  saveHighlight: (id: string, highlight: Highlight) => request({ type: 'annotate', id, highlight }),
  updateNote: (id: string, highlightId: string, note: string) =>
    request({ type: 'updateNote', id, highlightId, note }),
  createNotebook: (snapshot: ConversationSnapshot, title?: string) =>
    request({ type: 'create', snapshot, title }),
  finishNotebook: (id: string) => request({ type: 'finish', id }),
  clearHighlights: (id: string) => request({ type: 'clear', id }),
  renameNotebook: (id: string, title: string) => request({ type: 'rename', id, title }),
  removeHighlight: (id: string, highlightId: string) =>
    request({ type: 'removeHighlight', id, highlightId }),
  async getCurrentNotebook(snapshot: ConversationSnapshot) {
    const db = await request({ type: 'list' });
    return db.notebooks.find(
      (n) => n.id === db.activeByConversation[`${snapshot.platform}:${snapshot.conversationId}`],
    );
  },
  subscribe(callback: () => void) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[STORAGE_KEY]) callback();
    };
    const messageListener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      respond: (response: unknown) => void,
    ) => {
      if (
        sender.id === extension.runtime.id &&
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'notebooksChanged'
      ) {
        callback();
        respond({ ok: true });
      }
      return false;
    };
    extension.runtime.onMessage.addListener(messageListener);
    extension.storage.onChanged.addListener(listener);
    return () => {
      extension.storage.onChanged.removeListener(listener);
      extension.runtime.onMessage.removeListener(messageListener);
    };
  },
};
