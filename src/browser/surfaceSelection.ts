import type { NotebookSurface, SurfacePreference } from './surfacePreference';

export interface SurfaceDependencies {
  openSidePanel?: () => Promise<void>;
  panelIsVisible: () => Promise<boolean>;
  openWindow: () => Promise<void>;
  subscribeOpened?: (opened: () => void) => () => void;
}
function pause(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
function visibleWithin(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void Promise.resolve()
      .then(check)
      .then(
        (visible) => {
          clearTimeout(timer);
          resolve(visible);
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        },
      );
  });
}
export async function selectNotebookSurface(
  preference: SurfacePreference,
  dependencies: SurfaceDependencies,
  timeoutMs = 1800,
): Promise<NotebookSurface> {
  if (preference !== 'window' && dependencies.openSidePanel) {
    let opened = false;
    let failed = false;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = dependencies.subscribeOpened?.(() => {
        opened = true;
      });
    } catch {
      // Some shells expose partial event APIs. Visibility verification still works.
    }
    try {
      // Invoke before awaiting anything: Chrome requires the click's user gesture.
      try {
        void dependencies.openSidePanel().catch(() => {
          failed = true;
        });
      } catch {
        failed = true;
      }
      const deadline = Date.now() + timeoutMs;
      while (!failed && Date.now() < deadline) {
        if (opened) return 'side-panel';
        if (await visibleWithin(dependencies.panelIsVisible, Math.min(150, deadline - Date.now())))
          return 'side-panel';
        if (opened) return 'side-panel';
        if (!failed) await pause(Math.min(75, Math.max(0, deadline - Date.now())));
      }
    } finally {
      try {
        unsubscribe?.();
      } catch {
        /* A partial shell event API must not block fallback. */
      }
    }
  }
  await dependencies.openWindow();
  return 'window';
}
