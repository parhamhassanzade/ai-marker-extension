import { extension } from '../browser/api';
import { isSupportedUrl, type SourceCandidate } from '../browser/sourceTabs';

const SESSION_KEY = 'aiNotebook.sourceTabs';
/**
 * Live ChatGPT tabs, reported by their content scripts. Browsers such as Orion
 * may not support URL-pattern tab queries, so the notebook must not depend on them.
 */
export function createSourceTabRegistry(now = () => Date.now()) {
  const tabs = new Map<number, SourceCandidate>();
  // Session storage survives a suspended worker without persisting to disk.
  const session = () => extension.storage?.session;
  const loaded = Promise.resolve()
    .then(() => session()?.get(SESSION_KEY))
    .then((saved) => {
      const entries = saved?.[SESSION_KEY];
      if (!Array.isArray(entries)) return;
      for (const entry of entries as SourceCandidate[])
        if (Number.isSafeInteger(entry?.tabId) && !tabs.has(entry.tabId))
          tabs.set(entry.tabId, entry);
    })
    .catch(() => undefined);
  let saving: Promise<unknown> = Promise.resolve();
  const save = () => {
    saving = saving
      .then(() => session()?.set({ [SESSION_KEY]: [...tabs.values()] }))
      .catch(() => undefined);
    return saving;
  };
  async function hello(sender: chrome.runtime.MessageSender, title?: unknown) {
    const tab = sender.tab;
    const url = tab?.url ?? sender.url;
    if (tab?.id === undefined || (sender.frameId ?? 0) !== 0) return false;
    await loaded;
    if (!isSupportedUrl(url)) {
      if (tabs.delete(tab.id)) await save();
      return false;
    }
    tabs.set(tab.id, {
      tabId: tab.id,
      windowId: tab.windowId,
      url: url!,
      title: typeof title === 'string' && title ? title : (tab.title ?? ''),
      lastSeen: now(),
    });
    await save();
    return true;
  }
  async function remove(tabId: number) {
    await loaded;
    if (tabs.delete(tabId)) await save();
  }
  async function navigated(tabId: number, url?: string) {
    if (url && !isSupportedUrl(url)) await remove(tabId);
  }
  /** Verified live ChatGPT tabs, most recently seen first. */
  async function list(): Promise<SourceCandidate[]> {
    await loaded;
    const result = new Map<number, SourceCandidate>();
    let changed = false;
    await Promise.all(
      [...tabs.values()].map(async (entry) => {
        const tab = await extension.tabs.get(entry.tabId).catch(() => undefined);
        // Without a readable URL the content script's last report still stands.
        if (!tab || (tab.url && !isSupportedUrl(tab.url))) {
          tabs.delete(entry.tabId);
          changed = true;
          return;
        }
        result.set(entry.tabId, {
          ...entry,
          url: tab.url ?? entry.url,
          title: tab.title || entry.title,
          windowId: tab.windowId ?? entry.windowId,
        });
      }),
    );
    if (changed) await save();
    // Tabs open before installation or reload have no content script yet. An
    // unfiltered query still finds them where the browser supports it.
    const open = await Promise.resolve()
      .then(() => extension.tabs.query({}))
      .catch(() => [] as chrome.tabs.Tab[]);
    for (const tab of open ?? [])
      if (tab.id !== undefined && !result.has(tab.id) && isSupportedUrl(tab.url))
        result.set(tab.id, {
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url!,
          title: tab.title ?? '',
          lastSeen: tab.lastAccessed ?? 0,
        });
    return [...result.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }
  return { hello, remove, navigated, list, loaded };
}
export type SourceTabRegistry = ReturnType<typeof createSourceTabRegistry>;
