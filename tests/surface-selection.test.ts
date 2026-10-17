import { afterEach, expect, it, vi } from 'vitest';
import { selectNotebookSurface, type SurfaceDependencies } from '../src/browser/surfaceSelection';
import { surfacePreference } from '../src/browser/surfacePreference';
afterEach(() => vi.useRealTimers());
function dependencies(overrides: Partial<SurfaceDependencies> = {}) {
  return {
    openSidePanel: vi.fn().mockResolvedValue(undefined),
    panelIsVisible: vi.fn().mockResolvedValue(false),
    openWindow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
it('defaults invalid or missing saved values to automatic', () => {
  expect(surfacePreference(undefined)).toBe('auto');
  expect(surfacePreference('invalid')).toBe('auto');
  expect(surfacePreference('window')).toBe('window');
});
it('honors a window override without calling the panel API', async () => {
  const deps = dependencies();
  expect(await selectNotebookSurface('window', deps)).toBe('window');
  expect(deps.openSidePanel).not.toHaveBeenCalled();
  expect(deps.openWindow).toHaveBeenCalledOnce();
});
it('falls back when the API is missing, including explicit side-panel preference', async () => {
  const deps = dependencies({ openSidePanel: undefined });
  expect(await selectNotebookSurface('side-panel', deps)).toBe('window');
});
it('opens synchronously within the gesture and accepts a verified visible panel', async () => {
  const deps = dependencies({ panelIsVisible: async () => true });
  const result = selectNotebookSurface('auto', deps);
  expect(deps.openSidePanel).toHaveBeenCalledOnce();
  expect(await result).toBe('side-panel');
  expect(deps.openWindow).not.toHaveBeenCalled();
});
it.each(['reject', 'throw', 'no-op', 'hang', 'visibility failure', 'visibility hang'])(
  'falls back for %s',
  async (mode) => {
    vi.useFakeTimers();
    const deps = dependencies();
    if (mode === 'reject') deps.openSidePanel = vi.fn().mockRejectedValue(new Error('unsupported'));
    if (mode === 'throw')
      deps.openSidePanel = () => {
        throw new Error('unsupported');
      };
    if (mode === 'hang') deps.openSidePanel = () => new Promise<void>(() => undefined);
    if (mode === 'visibility failure')
      deps.panelIsVisible = () => Promise.reject(new Error('unsupported'));
    if (mode === 'visibility hang')
      deps.panelIsVisible = () => new Promise<boolean>(() => undefined);
    const result = selectNotebookSurface('auto', deps, 300);
    await vi.runAllTimersAsync();
    expect(await result).toBe('window');
    expect(deps.openWindow).toHaveBeenCalledOnce();
  },
);
it('accepts a matching panel-open event and removes the listener', async () => {
  const cleanup = vi.fn();
  const deps = dependencies({
    subscribeOpened: (opened) => {
      opened();
      return cleanup;
    },
  });
  expect(await selectNotebookSurface('auto', deps)).toBe('side-panel');
  expect(cleanup).toHaveBeenCalledOnce();
});
it('reports a failed window fallback to the caller', async () => {
  await expect(
    selectNotebookSurface(
      'window',
      dependencies({
        openWindow: async () => {
          throw new Error('blocked');
        },
      }),
    ),
  ).rejects.toThrow('blocked');
});

it('uses visibility verification if a shell rejects event subscription', async () => {
  const deps = dependencies({
    panelIsVisible: async () => true,
    subscribeOpened: () => {
      throw new Error('unsupported event');
    },
  });
  expect(await selectNotebookSurface('auto', deps)).toBe('side-panel');
});
it('still falls back if a shell rejects event listener cleanup', async () => {
  vi.useFakeTimers();
  const deps = dependencies({
    subscribeOpened: () => () => {
      throw new Error('unsupported cleanup');
    },
  });
  const result = selectNotebookSurface('auto', deps, 100);
  await vi.runAllTimersAsync();
  expect(await result).toBe('window');
});
