import { extension, isExtensionContext } from './api';
export const SURFACE_VISIBILITY_PORT = 'notebook-surface-visibility';

export function reportNotebookVisibility() {
  if (!isExtensionContext() || !('side_panel' in extension.runtime.getManifest())) return;
  let port: chrome.runtime.Port | undefined;
  let closed = false;
  const report = async () => {
    if (closed) return;
    try {
      if (!port) {
        port = extension.runtime.connect({ name: SURFACE_VISIBILITY_PORT });
        port.onDisconnect.addListener(() => {
          port = undefined;
        });
      }
      const window = await extension.windows.getCurrent();
      port?.postMessage({ windowId: window.id, visible: document.visibilityState === 'visible' });
    } catch {
      port = undefined;
    }
  };
  document.addEventListener('visibilitychange', () => void report());
  window.addEventListener('focus', () => void report());
  // A probe reconnects an already-open panel after its worker was suspended.
  extension.runtime.onMessage.addListener((message) => {
    if (message?.type === 'probeNotebookVisibility') void report();
    return false;
  });
  window.addEventListener('pagehide', () => {
    closed = true;
    port?.disconnect();
  });
  void report();
}
