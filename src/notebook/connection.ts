import { extension } from '../browser/api';
import type { ConversationSnapshot } from '../types';
export function isSupportedUrl(url?: string): boolean {
  try {
    const parsed = new URL(url ?? '');
    return (
      parsed.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
const injections = new Map<number, Promise<void>>();
export async function ensureContentScript(tabId: number): Promise<void> {
  const version = extension.runtime.getManifest().version;
  try {
    const pong = await extension.tabs.sendMessage<{ type: string }, { version: string }>(tabId, {
      type: 'ping',
    });
    if (pong?.version === version) return;
  } catch {
    /* Existing tabs may predate installation or extension reload. */
  }
  let pending = injections.get(tabId);
  if (!pending) {
    pending = extension.scripting
      .executeScript({ target: { tabId }, files: ['content.js'] })
      .then(() => undefined)
      .finally(() => injections.delete(tabId));
    injections.set(tabId, pending);
  }
  try {
    await pending;
  } catch {
    throw new Error('Unable to access this ChatGPT tab. Allow AI Notebook on this site and retry.');
  }
}
export async function conversationFromTab(tabId: number): Promise<ConversationSnapshot> {
  await ensureContentScript(tabId);
  const snapshot = await extension.tabs.sendMessage<{ type: string }, ConversationSnapshot>(tabId, {
    type: 'context',
  });
  if (!snapshot?.platform || !Array.isArray(snapshot.messages))
    throw new Error('No ChatGPT conversation was found on this page.');
  return snapshot;
}
export async function currentSourceTab(): Promise<chrome.tabs.Tab> {
  const windowId = new URLSearchParams(location.search).get('sourceWindow');
  const query =
    windowId && /^\d+$/.test(windowId)
      ? { active: true, windowId: Number(windowId) }
      : { active: true, currentWindow: true };
  let tab = (await extension.tabs.query(query))[0];
  const sourceTab = new URLSearchParams(location.search).get('sourceTab');
  if (sourceTab && /^\d+$/.test(sourceTab) && tab?.url?.startsWith(extension.runtime.getURL('/')))
    tab = await extension.tabs.get(Number(sourceTab));
  if (!tab?.id || !isSupportedUrl(tab.url))
    throw new Error(
      'No ChatGPT conversation was found on this page. Open a conversation on chatgpt.com.',
    );
  return tab;
}
export async function currentConversation(): Promise<{
  tabId: number;
  snapshot: ConversationSnapshot;
}> {
  const tab = await currentSourceTab();
  return { tabId: tab.id!, snapshot: await conversationFromTab(tab.id!) };
}
export async function waitForLoadedMessages(tabId: number): Promise<ConversationSnapshot> {
  let snapshot = await conversationFromTab(tabId);
  for (let attempt = 0; !snapshot.messages.length && attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    snapshot = await conversationFromTab(tabId);
  }
  if (!snapshot.messages.length)
    throw new Error(
      'No conversation messages were found. Wait for ChatGPT to finish loading, then retry Notebook Mode.',
    );
  return snapshot;
}
