import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DONATION_URL } from '../src/config';
import { AboutSupport, ExportSupport } from '../src/notebook/Support';
import {
  exportWithSupport,
  shouldShowSupport,
  supportState,
  support,
  SUPPORT_STORAGE_KEY,
  mergeSupportState,
} from '../src/storage/support';

afterEach(() => vi.unstubAllGlobals());
it('does not let a stale initial read or another view reverse a dismissal', () => {
  expect(
    mergeSupportState(
      { successfulPdfExports: 5, dismissed: true },
      { successfulPdfExports: 3, dismissed: false },
    ),
  ).toEqual({ successfulPdfExports: 5, dismissed: true });
});
it('shows the note only at the third success and later, unless dismissed', () => {
  for (const count of [0, 1, 2])
    expect(shouldShowSupport({ successfulPdfExports: count, dismissed: false })).toBe(false);
  for (const count of [3, 4, 100]) {
    expect(shouldShowSupport({ successfulPdfExports: count, dismissed: false })).toBe(true);
    expect(shouldShowSupport({ successfulPdfExports: count, dismissed: true })).toBe(false);
  }
});
it('preserves dismissal when repairing malformed counters', () => {
  expect(supportState(undefined)).toEqual({ successfulPdfExports: 0, dismissed: false });
  for (const count of [-1, 0.5, Infinity, '3', Number.MAX_SAFE_INTEGER + 1])
    expect(supportState({ successfulPdfExports: count, dismissed: true })).toEqual({
      successfulPdfExports: 0,
      dismissed: true,
    });
});
it('records exactly one success after export completion', async () => {
  const order: string[] = [];
  const state = { successfulPdfExports: 3, dismissed: false };
  const record = vi.fn(async () => {
    order.push('record');
    return state;
  });
  const updated = vi.fn();
  await exportWithSupport(
    async () => {
      order.push('export');
    },
    record,
    updated,
  );
  await vi.waitFor(() => expect(updated).toHaveBeenCalledWith(state));
  expect(order).toEqual(['export', 'record']);
  expect(record).toHaveBeenCalledOnce();
});
it('does not count failed or empty exports', async () => {
  for (const reason of ['Download failed', 'This notebook has no conversation messages.']) {
    const record = vi.fn(),
      updated = vi.fn();
    await expect(
      exportWithSupport(
        async () => {
          throw new Error(reason);
        },
        record,
        updated,
      ),
    ).rejects.toThrow(reason);
    expect(record).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
  }
});
it('does not delay exports for slow storage or convert preference failures into export errors', async () => {
  const pending = vi.fn(() => new Promise<never>(() => undefined));
  await expect(exportWithSupport(async () => undefined, pending, vi.fn())).resolves.toBeUndefined();
  const updated = vi.fn();
  await expect(
    exportWithSupport(
      async () => undefined,
      async () => {
        throw new Error('Storage full');
      },
      updated,
    ),
  ).resolves.toBeUndefined();
  await Promise.resolve();
  expect(updated).not.toHaveBeenCalled();
});
it('uses the one config URL and safe new-tab attributes on both UI links', () => {
  const html =
    renderToStaticMarkup(createElement(AboutSupport)) +
    renderToStaticMarkup(
      createElement(ExportSupport, {
        state: { successfulPdfExports: 3, dismissed: false },
        onChange: vi.fn(),
      }),
    );
  document.body.innerHTML = html;
  const links = [...document.querySelectorAll('a')];
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.getAttribute('href')).toBe(DONATION_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toBe(
      'Support AI Notebook on Ko-fi (opens in a new tab)',
    );
  }
  expect(document.querySelector('details')!.open).toBe(false);
  expect(document.body.textContent).toContain('Support this project ♥');
  expect(document.body.textContent).toContain("Don't show again");
  expect(document.querySelector('[dir="auto"]')).not.toBeNull();
});
it('renders no export note below threshold or after dismissal', () => {
  for (const state of [
    { successfulPdfExports: 2, dismissed: false },
    { successfulPdfExports: 30, dismissed: true },
  ])
    expect(renderToStaticMarkup(createElement(ExportSupport, { state, onChange: vi.fn() }))).toBe(
      '',
    );
});
it('keeps the preference synchronized between views and unsubscribes cleanly', () => {
  let listener: (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => void = () => undefined;
  const removeListener = vi.fn();
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: (value: typeof listener) => {
          listener = value;
        },
        removeListener,
      },
    },
  });
  const update = vi.fn();
  const stop = support.subscribe(update);
  listener({ other: { newValue: 1 } }, 'local');
  expect(update).not.toHaveBeenCalled();
  listener(
    { [SUPPORT_STORAGE_KEY]: { newValue: { successfulPdfExports: 3, dismissed: true } } },
    'local',
  );
  expect(update).toHaveBeenCalledWith({ successfulPdfExports: 3, dismissed: true });
  stop();
  expect(removeListener).toHaveBeenCalledWith(listener);
});
