import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

async function setup(manager?: Partial<Pick<StorageManager, 'persist' | 'persisted'>>) {
  vi.stubGlobal('navigator', { storage: manager });
  return (await import('../src/storage/persistence')).requestNotebookPersistence;
}

it('does not request permission for an empty library, but requests after first creation', async () => {
  const persist = vi.fn().mockResolvedValue(true);
  const request = await setup({ persist });
  expect(await request(0)).toBe('not-needed');
  expect(persist).not.toHaveBeenCalled();
  expect(await request(1)).toBe('granted');
  expect(persist).toHaveBeenCalledOnce();
});

it('does not prompt when persistence is already granted', async () => {
  const persist = vi.fn();
  const request = await setup({ persisted: vi.fn().mockResolvedValue(true), persist });
  expect(await request(2)).toBe('granted');
  expect(persist).not.toHaveBeenCalled();
});

it('deduplicates concurrent requests and later notebook changes', async () => {
  const persist = vi.fn().mockResolvedValue(true);
  const persisted = vi.fn().mockResolvedValue(false);
  const request = await setup({ persist, persisted });
  expect(await Promise.all([request(1), request(1), request(2)])).toEqual([
    'granted',
    'granted',
    'granted',
  ]);
  expect(persisted).toHaveBeenCalledOnce();
  expect(persist).toHaveBeenCalledOnce();
});

it('handles denial without prompting again for later updates', async () => {
  const persist = vi.fn().mockResolvedValue(false);
  const request = await setup({ persisted: vi.fn().mockResolvedValue(false), persist });
  expect(await request(1)).toBe('denied');
  expect(await request(2)).toBe('denied');
  expect(persist).toHaveBeenCalledOnce();
});

it('handles browsers without the StorageManager API', async () => {
  expect(await (await setup())(1)).toBe('unsupported');
});

it('handles a partial StorageManager without persist()', async () => {
  const persisted = vi.fn().mockResolvedValue(false);
  expect(await (await setup({ persisted }))(1)).toBe('unsupported');
  expect(persisted).not.toHaveBeenCalled();
});

it('contains a rejected permission request without retrying during updates', async () => {
  const persist = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
  const request = await setup({ persist });
  expect(await request(1)).toBe('failed');
  expect(await request(2)).toBe('failed');
  expect(persist).toHaveBeenCalledOnce();
});

it('contains failures while checking an existing grant', async () => {
  const persist = vi.fn();
  const request = await setup({
    persisted: vi.fn().mockRejectedValue(new Error('Access denied')),
    persist,
  });
  expect(await request(1)).toBe('failed');
  expect(persist).not.toHaveBeenCalled();
});

it('can try again when the extension page is reopened', async () => {
  const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await (await setup({ persist }))(1)).toBe('denied');
  vi.resetModules();
  expect(await (await setup({ persist }))(1)).toBe('granted');
  expect(persist).toHaveBeenCalledTimes(2);
});
