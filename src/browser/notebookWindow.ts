import { extension } from './api';
export async function openNotebookWindow(tab: chrome.tabs.Tab) {
  if (tab.windowId === undefined) throw new Error('Open a ChatGPT tab and try again.');
  const base = extension.runtime.getURL('sidepanel.html');
  const url = `${base}?sourceWindow=${tab.windowId}&sourceTab=${tab.id ?? ''}`;
  const windows = await extension.windows
    .getAll({ populate: true, windowTypes: ['popup'] })
    .catch(() => []);
  const existing = windows.find((window) => window.tabs?.some((t) => t.url?.startsWith(base)));
  if (existing?.id !== undefined) {
    const view = existing.tabs?.find((t) => t.url?.startsWith(base));
    if (view?.id !== undefined) await extension.tabs.update(view.id, { url });
    await extension.windows.update(existing.id, { focused: true });
    return;
  }
  try {
    await extension.windows.create({ url, type: 'popup', width: 480, height: 860, focused: true });
  } catch {
    // Some Chromium shells disallow extension windows. A regular notebook tab
    // still works, with sourceTab preserving the chat while that tab is active.
    await extension.tabs.create({ url, windowId: tab.windowId });
  }
}
