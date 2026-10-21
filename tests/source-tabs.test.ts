import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NoSourceTabError,
  resolveSourceTab,
  type SourceCandidate,
  type SourceResolverDependencies,
} from '../src/browser/sourceTabs';
import { createSourceTabRegistry } from '../src/background/sourceTabRegistry';

const base = 'chrome-extension://test/';
const notebook = { id: 50, windowId: 1, url: `${base}sidepanel.html` } as chrome.tabs.Tab;
const chat = (id: number, path = `c/${id}`) =>
  ({ id, windowId: 1, url: `https://chatgpt.com/${path}`, title: `Chat ${id}` }) as chrome.tabs.Tab;
const candidate = (id: number, lastSeen: number): SourceCandidate => ({
  tabId: id,
  windowId: 1,
  url: `https://chatgpt.com/c/${id}`,
  title: `Chat ${id}`,
  lastSeen,
});
function deps(overrides: Partial<SourceResolverDependencies> & { search?: string } = {}) {
  const { search = '', ...rest } = overrides;
  return {
    params: new URLSearchParams(search),
    extensionUrl: base,
    ownTab: vi.fn().mockResolvedValue(notebook),
    activeTab: vi.fn().mockResolvedValue(notebook),
    getTab: vi.fn().mockRejectedValue(new Error('No tab')),
    registeredTabs: vi.fn().mockResolvedValue([]),
    ...rest,
  } satisfies SourceResolverDependencies;
}

describe('resolveSourceTab', () => {
  it('uses an explicit source tab id when the notebook is its own active tab', async () => {
    const getTab = vi.fn().mockResolvedValue(chat(7));
    const result = await resolveSourceTab(deps({ search: '?sourceTabId=7', getTab }));
    expect(result).toMatchObject({ via: 'explicit', tab: { id: 7 }, candidates: [] });
    expect(getTab).toHaveBeenCalledWith(7);
  });

  it('accepts the legacy sourceTab parameter written by the window launcher', async () => {
    const getTab = vi.fn().mockResolvedValue(chat(7));
    const result = await resolveSourceTab(deps({ search: '?sourceWindow=1&sourceTab=7', getTab }));
    expect(result).toMatchObject({ via: 'explicit', tab: { id: 7 } });
  });

  it('falls back to the most recently seen registered tab without a source id', async () => {
    const result = await resolveSourceTab(
      deps({ registeredTabs: vi.fn().mockResolvedValue([candidate(9, 200)]) }),
    );
    expect(result).toMatchObject({ via: 'registry', tab: { id: 9 }, candidates: [] });
  });

  it('falls back to the registry when the explicit tab was closed or left ChatGPT', async () => {
    const registeredTabs = vi.fn().mockResolvedValue([candidate(9, 200)]);
    const closed = await resolveSourceTab(deps({ search: '?sourceTabId=7', registeredTabs }));
    expect(closed).toMatchObject({ via: 'registry', tab: { id: 9 } });
    const left = await resolveSourceTab(
      deps({
        search: '?sourceTabId=7',
        registeredTabs,
        getTab: vi.fn().mockResolvedValue({ id: 7, url: 'https://example.com/' }),
      }),
    );
    expect(left).toMatchObject({ via: 'registry', tab: { id: 9 } });
  });

  it('offers a picker and preselects the most recent tab when several are open', async () => {
    const registered = [candidate(9, 300), candidate(8, 200)];
    const result = await resolveSourceTab(
      deps({ registeredTabs: vi.fn().mockResolvedValue(registered) }),
    );
    expect(result.tab.id).toBe(9);
    expect(result.candidates.map((c) => c.tabId)).toEqual([9, 8]);
  });

  it('keeps the explicit tab selected and still lists other conversations', async () => {
    const result = await resolveSourceTab(
      deps({
        search: '?sourceTabId=7',
        getTab: vi.fn().mockResolvedValue(chat(7)),
        registeredTabs: vi.fn().mockResolvedValue([candidate(9, 300)]),
      }),
    );
    expect(result.tab.id).toBe(7);
    expect(result.candidates.map((c) => c.tabId)).toEqual([7, 9]);
  });

  it('reports a missing ChatGPT tab with the Refresh instruction', async () => {
    const failure = resolveSourceTab(deps());
    await expect(failure).rejects.toBeInstanceOf(NoSourceTabError);
    await expect(failure).rejects.toThrow(
      'Open ChatGPT or Claude in another tab, then tap Refresh.',
    );
  });

  it('treats a registry failure as no tabs rather than a crash', async () => {
    await expect(
      resolveSourceTab(deps({ registeredTabs: vi.fn().mockRejectedValue(new Error('x')) })),
    ).rejects.toBeInstanceOf(NoSourceTabError);
  });

  it('recognises its own tab by URL when the browser cannot report the current tab', async () => {
    const result = await resolveSourceTab(
      deps({
        ownTab: vi.fn().mockRejectedValue(new Error('Unsupported')),
        registeredTabs: vi.fn().mockResolvedValue([candidate(9, 1)]),
      }),
    );
    expect(result).toMatchObject({ via: 'registry', tab: { id: 9 } });
  });

  it('keeps side-panel behavior: follow the active tab and never fall back', async () => {
    const registeredTabs = vi.fn().mockResolvedValue([candidate(9, 1)]);
    const panel = { ownTab: vi.fn().mockResolvedValue(undefined), registeredTabs };
    const followed = await resolveSourceTab(
      deps({ ...panel, activeTab: vi.fn().mockResolvedValue(chat(3)) }),
    );
    expect(followed).toMatchObject({ via: 'active', tab: { id: 3 }, candidates: [] });
    const elsewhere = resolveSourceTab(
      deps({ ...panel, activeTab: vi.fn().mockResolvedValue({ id: 4, url: 'https://x.com/' }) }),
    );
    await expect(elsewhere).rejects.toThrow(/No AI conversation was found/);
    await expect(elsewhere).rejects.not.toBeInstanceOf(NoSourceTabError);
    expect(registeredTabs).not.toHaveBeenCalled();
  });

  it('keeps window behavior: follow the active ChatGPT tab of the source window', async () => {
    const activeTab = vi.fn().mockResolvedValue(chat(3));
    const result = await resolveSourceTab(
      deps({ search: '?sourceWindow=12&sourceTab=7', activeTab }),
    );
    expect(result).toMatchObject({ via: 'active', tab: { id: 3 } });
    expect(activeTab).toHaveBeenCalledWith(12);
  });

  it('never offers the notebook tab itself as a source', async () => {
    const result = await resolveSourceTab(
      deps({
        registeredTabs: vi.fn().mockResolvedValue([{ ...candidate(50, 999) }, candidate(9, 1)]),
      }),
    );
    expect(result.tab.id).toBe(9);
    expect(result.candidates).toEqual([]);
  });
});

describe('source tab registry', () => {
  afterEach(() => vi.unstubAllGlobals());
  function stub(open: Record<number, Partial<chrome.tabs.Tab>>, query?: () => Promise<unknown>) {
    const session: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async (id: number) => {
          if (!open[id]) throw new Error('No tab');
          return { id, ...open[id] };
        }),
        query: query ?? vi.fn().mockRejectedValue(new Error('Unsupported query')),
      },
      storage: {
        session: {
          get: async (key: string) => ({ [key]: session[key] }),
          set: async (value: Record<string, unknown>) => Object.assign(session, value),
        },
      },
    });
    return session;
  }
  const hello = (id: number, path = `c/${id}`) =>
    ({
      id: 'test',
      frameId: 0,
      url: `https://chatgpt.com/${path}`,
      tab: { id, windowId: 1, url: `https://chatgpt.com/${path}`, title: `Tab ${id}` },
    }) as chrome.runtime.MessageSender;

  it('records hello messages and lists tabs most recently seen first', async () => {
    stub({ 1: { url: 'https://chatgpt.com/c/1' }, 2: { url: 'https://chatgpt.com/c/2' } });
    let clock = 100;
    const registry = createSourceTabRegistry(() => clock++);
    expect(await registry.hello(hello(1), 'First')).toBe(true);
    expect(await registry.hello(hello(2), 'Second')).toBe(true);
    const tabs = await registry.list();
    expect(tabs.map((t) => [t.tabId, t.title])).toEqual([
      [2, 'Second'],
      [1, 'First'],
    ]);
  });

  it('removes closed tabs, tabs that navigate away, and stale entries', async () => {
    const open: Record<number, Partial<chrome.tabs.Tab>> = {
      1: { url: 'https://chatgpt.com/c/1' },
      2: { url: 'https://chatgpt.com/c/2' },
      3: { url: 'https://chatgpt.com/c/3' },
    };
    stub(open);
    const registry = createSourceTabRegistry();
    await Promise.all([1, 2, 3].map((id) => registry.hello(hello(id))));
    await registry.remove(1);
    await registry.navigated(2, 'https://example.com/');
    await registry.navigated(3, 'https://chatgpt.com/c/other');
    expect((await registry.list()).map((t) => t.tabId)).toEqual([3]);
    // A missed close event is caught when the entry is verified.
    delete open[3];
    expect(await registry.list()).toEqual([]);
  });

  it('ignores hellos from frames and from non-ChatGPT pages', async () => {
    stub({ 1: { url: 'https://chatgpt.com/c/1' } });
    const registry = createSourceTabRegistry();
    expect(await registry.hello({ ...hello(1), frameId: 2 })).toBe(false);
    expect(
      await registry.hello({
        ...hello(1),
        url: 'https://evil.example/',
        tab: { ...hello(1).tab!, url: 'https://evil.example/' },
      }),
    ).toBe(false);
    expect(await registry.list()).toEqual([]);
  });

  it('survives a worker restart through session storage', async () => {
    stub({ 4: { url: 'https://chatgpt.com/c/4' } });
    await createSourceTabRegistry().hello(hello(4), 'Kept');
    const restarted = createSourceTabRegistry();
    expect((await restarted.list()).map((t) => t.title)).toEqual(['Kept']);
  });

  it('adds open ChatGPT tabs that predate the content script when queries work', async () => {
    stub({}, async () => [
      { id: 5, url: 'https://chatgpt.com/c/5', title: 'Old', lastAccessed: 10 },
      { id: 6, url: 'https://example.com/' },
    ]);
    expect((await createSourceTabRegistry().list()).map((t) => t.tabId)).toEqual([5]);
  });
});
