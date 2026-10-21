import { openNotebookWindow } from '../browser/notebookWindow';
import { extension } from '../browser/api';
import {
  getSurfacePreference,
  surfacePreference,
  SURFACE_PREFERENCE_KEY,
  type SurfacePreference,
  type NotebookSurface,
} from '../browser/surfacePreference';
import { selectNotebookSurface } from '../browser/surfaceSelection';
import { SURFACE_VISIBILITY_PORT } from '../browser/surfaceVisibility';

export function configureNotebookSurface() {
  const manifest = extension.runtime.getManifest();
  if ('sidebar_action' in manifest && extension.sidebarAction) {
    // Firefox requires opening the sidebar directly inside the user gesture.
    extension.action.onClicked.addListener(() => {
      void extension.sidebarAction!.open().catch(console.error);
    });
    return;
  }
  let preference: SurfacePreference | undefined;
  let revision = 0;
  const ready = getSurfacePreference()
    .then((value) => {
      if (!revision) preference = value;
    })
    .catch(() => {
      preference ??= 'auto';
    });
  const setPreference = (value: SurfacePreference) => {
    revision++;
    preference = value;
  };
  extension.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && SURFACE_PREFERENCE_KEY in changes)
      setPreference(surfacePreference(changes[SURFACE_PREFERENCE_KEY]?.newValue));
  });
  // One launcher owns the toolbar click so failed/no-op shell APIs can fall back.
  void extension.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: false })
    .catch(console.error);
  const reports = new Map<string, { windowId: number; visible: boolean }>();
  extension.runtime.onConnect?.addListener((port) => {
    const sender = port.sender;
    if (
      port.name !== SURFACE_VISIBILITY_PORT ||
      sender?.id !== extension.runtime.id ||
      !sender.url?.startsWith(extension.runtime.getURL('sidepanel.html')) ||
      !sender.documentId
    )
      return;
    const documentId = sender.documentId;
    port.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'object' || !message) return;
      const value = message as Record<string, unknown>;
      if (Number.isSafeInteger(value.windowId) && typeof value.visible === 'boolean')
        reports.set(documentId, { windowId: value.windowId as number, visible: value.visible });
    });
    port.onDisconnect.addListener(() => reports.delete(documentId));
  });
  const opening = new Map<number, Promise<NotebookSurface>>();
  function open(tab: chrome.tabs.Tab): Promise<NotebookSurface> {
    // A fallback tab can itself be active when the toolbar is clicked again.
    if (tab.url?.startsWith(extension.runtime.getURL('sidepanel.html'))) {
      const params = new URL(tab.url).searchParams;
      if (
        /^\d+$/.test(params.get('sourceWindow') ?? '') &&
        /^\d+$/.test(params.get('sourceTab') ?? '')
      )
        tab = {
          ...tab,
          windowId: Number(params.get('sourceWindow')),
          id: Number(params.get('sourceTab')),
        };
    }
    const source = tab;
    const windowId = source.windowId;
    if (windowId === undefined)
      return Promise.reject(new Error('Open a ChatGPT or Claude tab and try again.'));
    const existing = opening.get(windowId);
    if (existing) return existing;
    const launch = () =>
      selectNotebookSurface(preference ?? 'auto', {
        openSidePanel:
          'side_panel' in manifest && extension.sidePanel?.open
            ? () => extension.sidePanel.open({ windowId })
            : undefined,
        panelIsVisible: async () => {
          void extension.runtime
            .sendMessage({ type: 'probeNotebookVisibility' })
            .catch(() => undefined);
          const contexts = await extension.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
          });
          // Chrome reports windowId -1 for some panel contexts. Match the browser's
          // document ID to the visible view's own window instead of trusting -1.
          return contexts.some((context) => {
            const report = reports.get(context.documentId ?? '');
            return report?.visible && report.windowId === windowId;
          });
        },
        subscribeOpened: (opened) => {
          const event = extension.sidePanel?.onOpened;
          const listener = (info: chrome.sidePanel.PanelOpenedInfo) => {
            if (info.windowId === windowId && info.path.replace(/^\//, '') === 'sidepanel.html')
              opened();
          };
          event?.addListener(listener);
          return () => event?.removeListener(listener);
        },
        openWindow: () => openNotebookWindow(source),
      });
    // A cold worker must read a saved window override first. If this consumes
    // Chrome's gesture, the rejected panel call follows the same window fallback.
    const task = (preference === undefined ? ready.then(launch) : launch()).finally(() =>
      opening.delete(windowId),
    );
    opening.set(windowId, task);
    return task;
  }
  extension.action.onClicked.addListener((tab) => {
    void open(tab).catch(console.error);
  });
  return { open, ready, setPreference };
}
