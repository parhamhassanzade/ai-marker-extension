import { isSupportedUrl } from '../platforms';
export { isSupportedUrl };
export const SOURCE_HELLO = 'sourceHello';
export const LIST_SOURCE_TABS = 'listSourceTabs';
export const NO_SOURCE_TAB_MESSAGE = 'Open ChatGPT or Claude in another tab, then tap Refresh.';
const NO_CONVERSATION_MESSAGE =
  'No AI conversation was found on this page. Open a conversation on ChatGPT or Claude.';

export interface SourceCandidate {
  tabId: number;
  windowId?: number;
  url: string;
  title: string;
  lastSeen: number;
}
/** A notebook tab with no ChatGPT tab to read from: show the Refresh prompt. */
export class NoSourceTabError extends Error {
  constructor() {
    super(NO_SOURCE_TAB_MESSAGE);
    this.name = 'NoSourceTabError';
  }
}
export interface SourceResolverDependencies {
  params: URLSearchParams;
  /** The extension's own base URL, used to recognise the notebook's own tab. */
  extensionUrl: string;
  /** The notebook's own tab, or undefined in a side panel or sidebar. */
  ownTab(): Promise<chrome.tabs.Tab | undefined>;
  activeTab(windowId?: number): Promise<chrome.tabs.Tab | undefined>;
  getTab(tabId: number): Promise<chrome.tabs.Tab | undefined>;
  /** Live ChatGPT tabs known to the worker, most recently seen first. */
  registeredTabs(): Promise<SourceCandidate[]>;
}
export interface SourceResolution {
  tab: chrome.tabs.Tab;
  via: 'active' | 'explicit' | 'registry';
  /** Set when the user can switch between several ChatGPT tabs. */
  candidates: SourceCandidate[];
}
const numeric = (value: string | null) =>
  value && /^\d+$/.test(value) ? Number(value) : undefined;
export async function resolveSourceTab(
  deps: SourceResolverDependencies,
): Promise<SourceResolution> {
  const sourceWindow = numeric(deps.params.get('sourceWindow'));
  const explicit = numeric(deps.params.get('sourceTabId') ?? deps.params.get('sourceTab'));
  const [own, active] = await Promise.all([
    deps.ownTab().catch(() => undefined),
    deps.activeTab(sourceWindow).catch(() => undefined),
  ]);
  const isOwnTab = (tab?: chrome.tabs.Tab) =>
    !!tab &&
    ((own?.id !== undefined && tab.id === own.id) || !!tab.url?.startsWith(deps.extensionUrl));
  // A side panel follows the active tab of its window, exactly as before.
  if (active?.id !== undefined && !isOwnTab(active) && isSupportedUrl(active.url))
    return { tab: active, via: 'active', candidates: [] };
  const inTab = own?.id !== undefined || isOwnTab(active);
  if (sourceWindow === undefined && explicit === undefined && !inTab)
    throw new Error(NO_CONVERSATION_MESSAGE);
  // A notebook tab (e.g. Orion on iPad) is itself the active tab, so it reads
  // the tab it was opened from, then the most recently seen ChatGPT tab.
  const registered = (await deps.registeredTabs().catch(() => [])).filter(
    (candidate) => candidate.tabId !== own?.id,
  );
  if (explicit !== undefined) {
    const tab = await deps.getTab(explicit).catch(() => undefined);
    if (tab?.id !== undefined && isSupportedUrl(tab.url)) {
      const candidates = registered.some((c) => c.tabId === tab.id)
        ? registered
        : [
            {
              tabId: tab.id,
              windowId: tab.windowId,
              url: tab.url!,
              title: tab.title ?? '',
              lastSeen: 0,
            },
            ...registered,
          ];
      return { tab, via: 'explicit', candidates: candidates.length > 1 ? candidates : [] };
    }
  }
  const [latest] = registered;
  if (!latest) throw new NoSourceTabError();
  return {
    tab: {
      id: latest.tabId,
      windowId: latest.windowId,
      url: latest.url,
      title: latest.title,
    } as chrome.tabs.Tab,
    via: 'registry',
    candidates: registered.length > 1 ? registered : [],
  };
}
