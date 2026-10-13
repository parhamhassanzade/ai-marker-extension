import { afterEach, expect, it, vi } from 'vitest';
import { storage } from '../src/storage/storage';
import type { ConversationSnapshot, Highlight } from '../src/types';
const snapshot = {} as ConversationSnapshot;
const highlight = {} as Highlight;
afterEach(() => vi.unstubAllGlobals());
it('explains the reload required when a new toolbar connects to an older worker', async () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: 'Invalid notebook request.' });
  vi.stubGlobal('chrome', { runtime: { id: 'extension', sendMessage } });
  await expect(storage.saveSourceHighlight(snapshot, highlight)).rejects.toThrow(
    'chrome://extensions',
  );
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'capabilities' });
});
it('saves the source highlight when the worker supports the toolbar protocol', async () => {
  const data = { notebooks: [] };
  const sendMessage = vi
    .fn()
    .mockResolvedValueOnce({ sourceHighlights: true })
    .mockResolvedValueOnce({ ok: true, data });
  vi.stubGlobal('chrome', { runtime: { id: 'extension', sendMessage } });
  expect(await storage.saveSourceHighlight(snapshot, highlight)).toEqual(data);
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'sourceHighlight', snapshot, highlight });
});
