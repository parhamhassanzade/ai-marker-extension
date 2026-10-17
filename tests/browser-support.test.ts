import { afterEach, expect, it, vi } from 'vitest';
import { extension } from '../src/browser/api';
import { configureNotebookSurface } from '../src/background/notebookSurface';
afterEach(() => vi.unstubAllGlobals());
it('prefers Firefox Promise APIs over its Chrome compatibility namespace', () => {
  const native = { runtime: { id: 'firefox' } };
  vi.stubGlobal('browser', native);
  vi.stubGlobal('chrome', { runtime: { id: 'chrome' } });
  expect(extension.runtime.id).toBe('firefox');
});
it('opens the Firefox sidebar directly in the toolbar click gesture', () => {
  let click: () => void = () => undefined;
  const open = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('browser', {
    runtime: { getManifest: () => ({ sidebar_action: {} }) },
    sidebarAction: { open },
    action: {
      onClicked: {
        addListener: (listener: () => void) => {
          click = listener;
        },
      },
    },
  });
  configureNotebookSurface();
  click();
  expect(open).toHaveBeenCalledOnce();
});
it('opens an Arc notebook window tied to the originating browser window', async () => {
  let click: (tab: Partial<chrome.tabs.Tab>) => void = () => undefined;
  const create = vi.fn().mockResolvedValue({});
  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: () => ({}),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: { local: { get: async () => ({}) } },
    windows: { getAll: async () => [], create },
    action: {
      onClicked: {
        addListener: (listener: typeof click) => {
          click = listener;
        },
      },
    },
  });
  configureNotebookSurface();
  click({ id: 8, windowId: 4 });
  await vi.waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'chrome-extension://test/sidepanel.html?sourceWindow=4&sourceTab=8',
        type: 'popup',
      }),
    ),
  );
});
it('opens a notebook tab if the browser rejects standalone extension windows', async () => {
  const { openNotebookWindow } = await import('../src/browser/notebookWindow');
  const create = vi.fn().mockResolvedValue({});
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    windows: {
      getAll: async () => [],
      create: async () => {
        throw new Error('Unsupported');
      },
    },
    tabs: { create },
  });
  await openNotebookWindow({ id: 8, windowId: 4 } as chrome.tabs.Tab);
  expect(create).toHaveBeenCalledWith({
    url: 'chrome-extension://test/sidepanel.html?sourceWindow=4&sourceTab=8',
    windowId: 4,
  });
});
