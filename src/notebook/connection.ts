import { extension } from '../browser/api';
import type { ConversationSnapshot } from '../types';
import {
  LIST_SOURCE_TABS,
  resolveSourceTab,
  type SourceCandidate,
  type SourceResolution,
} from '../browser/sourceTabs';
export { isSupportedUrl, NoSourceTabError, type SourceCandidate } from '../browser/sourceTabs';
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
    throw new Error('Unable to access this tab. Allow AI Notebook on this site and retry.');
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
export function currentSource(): Promise<SourceResolution> {
  return resolveSourceTab({
    params: new URLSearchParams(location.search),
    extensionUrl: extension.runtime.getURL('/'),
    ownTab: async () => extension.tabs.getCurrent?.(),
    activeTab: async (windowId) =>
      (
        await extension.tabs.query(
          windowId === undefined
            ? { active: true, currentWindow: true }
            : { active: true, windowId },
        )
      )[0],
    getTab: async (tabId) => extension.tabs.get(tabId),
    registeredTabs: async () => {
      const result = await extension.runtime.sendMessage<
        { type: string },
        { ok: boolean; tabs?: SourceCandidate[] }
      >({ type: LIST_SOURCE_TABS });
      return result?.ok && Array.isArray(result.tabs) ? result.tabs : [];
    },
  });
}
export async function currentSourceTab(): Promise<chrome.tabs.Tab> {
  return (await currentSource()).tab;
}
/** Pin a notebook tab to the conversation the user picked. */
export function chooseSourceTab(tabId: number) {
  const url = new URL(location.href);
  url.searchParams.delete('sourceTabId');
  url.searchParams.set('sourceTab', String(tabId));
  history.replaceState(history.state, '', url);
}
export async function currentConversation(): Promise<{
  tabId: number;
  snapshot: ConversationSnapshot;
  candidates: SourceCandidate[];
}> {
  const { tab, candidates } = await currentSource();
  return { tabId: tab.id!, snapshot: await conversationFromTab(tab.id!), candidates };
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
