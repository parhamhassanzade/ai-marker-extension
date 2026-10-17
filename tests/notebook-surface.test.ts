import { afterEach, expect, it, vi } from 'vitest';
import { configureNotebookSurface } from '../src/background/notebookSurface';
import { SURFACE_PREFERENCE_KEY } from '../src/browser/surfacePreference';
import { SURFACE_VISIBILITY_PORT } from '../src/browser/surfaceVisibility';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup(saved: unknown = 'auto') {
  let clicked: (tab: chrome.tabs.Tab) => void = () => undefined;
  let connected: (port: unknown) => void = () => undefined;
  let opened: (info: { windowId: number; path: string }) => void = () => undefined;
  let changed: (changes: Record<string, unknown>, area: string) => void = () => undefined;
  const create = vi.fn().mockResolvedValue({});
  const panelOpen = vi.fn().mockResolvedValue(undefined);
  const getContexts = vi.fn().mockResolvedValue([]);
  const localGet = vi.fn().mockResolvedValue({ [SURFACE_PREFERENCE_KEY]: saved });
  const behavior = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test',
      getManifest: () => ({ side_panel: {} }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      ContextType: { SIDE_PANEL: 'SIDE_PANEL' },
      getContexts,
      sendMessage: async () => undefined,
      onConnect: {
        addListener: (fn: typeof connected) => {
          connected = fn;
        },
      },
    },
    action: {
      onClicked: {
        addListener: (fn: typeof clicked) => {
          clicked = fn;
        },
      },
    },
    sidePanel: {
      open: panelOpen,
      setPanelBehavior: behavior,
      onOpened: {
        addListener: (fn: typeof opened) => {
          opened = fn;
        },
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: { get: localGet },
      onChanged: {
        addListener: (fn: typeof changed) => {
          changed = fn;
        },
      },
    },
    windows: { getAll: async () => [], create },
  });
  return {
    panelOpen,
    create,
    getContexts,
    localGet,
    behavior,
    click: (tab: chrome.tabs.Tab) => clicked(tab),
    emitOpened: (windowId: number) => opened({ windowId, path: '/sidepanel.html' }),
    change: (value: unknown) => changed({ [SURFACE_PREFERENCE_KEY]: { newValue: value } }, 'local'),
    report: (documentId: string, windowId: number, visible: boolean) => {
      let receive: (message: unknown) => void = () => undefined;
      connected({
        name: SURFACE_VISIBILITY_PORT,
        sender: { id: 'test', url: 'chrome-extension://test/sidepanel.html', documentId },
        onMessage: {
          addListener: (fn: typeof receive) => {
            receive = fn;
          },
        },
        onDisconnect: { addListener: () => undefined },
      });
      receive({ windowId, visible });
    },
  };
}
const tab = { id: 8, windowId: 4 } as chrome.tabs.Tab;
it('honors a saved window setting even on the first cold-worker click', async () => {
  const mock = setup('window');
  const controller = configureNotebookSurface()!;
  expect(mock.behavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
  mock.click(tab);
  await vi.waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
  expect(mock.panelOpen).not.toHaveBeenCalled();
  await controller.ready;
});
it('deduplicates concurrent clicks and ignores open events for a different window', async () => {
  vi.useFakeTimers();
  const mock = setup();
  const controller = configureNotebookSurface()!;
  await controller.ready;
  const first = controller.open(tab);
  expect(mock.panelOpen).toHaveBeenCalledOnce();
  expect(controller.open(tab)).toBe(first);
  mock.emitOpened(99);
  await vi.runAllTimersAsync();
  expect(await first).toBe('window');
  expect(mock.create).toHaveBeenCalledOnce();
});
it('verifies panel document IDs even when Chrome reports context windowId -1', async () => {
  const mock = setup();
  const controller = configureNotebookSurface()!;
  await controller.ready;
  mock.getContexts.mockResolvedValue([{ documentId: 'actual-panel', windowId: -1 }]);
  mock.report('actual-panel', 4, true);
  expect(await controller.open(tab)).toBe('side-panel');
  expect(mock.create).not.toHaveBeenCalled();
});
it.each(['ordinary-tab', 'hidden', 'wrong-window'])(
  'does not trust a %s visibility report',
  async (mode) => {
    vi.useFakeTimers();
    const mock = setup();
    const controller = configureNotebookSurface()!;
    await controller.ready;
    mock.getContexts.mockResolvedValue([{ documentId: 'actual-panel', windowId: -1 }]);
    mock.report(
      mode === 'ordinary-tab' ? 'other-document' : 'actual-panel',
      mode === 'wrong-window' ? 99 : 4,
      mode !== 'hidden',
    );
    const result = controller.open(tab);
    await vi.runAllTimersAsync();
    expect(await result).toBe('window');
  },
);
it('restores the source IDs when launched from a fallback notebook tab', async () => {
  const mock = setup('window');
  const controller = configureNotebookSurface()!;
  await controller.open({
    id: 40,
    windowId: 10,
    url: 'chrome-extension://test/sidepanel.html?sourceWindow=4&sourceTab=8',
  } as chrome.tabs.Tab);
  expect(mock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'chrome-extension://test/sidepanel.html?sourceWindow=4&sourceTab=8',
    }),
  );
});
it('a new preference cannot be overwritten by an older pending storage read', async () => {
  const mock = setup();
  let resolve: (value: unknown) => void = () => undefined;
  mock.localGet.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const controller = configureNotebookSurface()!;
  mock.change('window');
  resolve({ [SURFACE_PREFERENCE_KEY]: 'auto' });
  await controller.ready;
  expect(await controller.open(tab)).toBe('window');
  expect(mock.panelOpen).not.toHaveBeenCalled();
});

it('accepts Chrome panel events with a leading slash in their path', async () => {
  const mock = setup();
  const controller = configureNotebookSurface()!;
  await controller.ready;
  const result = controller.open(tab);
  mock.emitOpened(4);
  expect(await result).toBe('side-panel');
  expect(mock.create).not.toHaveBeenCalled();
});
