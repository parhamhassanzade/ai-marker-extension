import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter';
import { conversationIdOf, platformOf } from '../src/platforms';
import { isSnapshot } from '../src/storage/validation';
import { matchesHighlightSource } from '../src/background/sourceAuthorization';
import { syncClaudeContentScript } from '../src/background/optionalPlatforms';
import type { ConversationSnapshot } from '../src/types';

const snapshot: ConversationSnapshot = {
  platform: 'Claude',
  conversationId: 'abc-123',
  title: 'Chat',
  website: 'https://claude.ai/chat/abc-123',
  messages: [{ id: 'claude-0:user', role: 'user', text: 'hi' }],
};

describe('platform table', () => {
  it('recognises Claude and ChatGPT hosts, HTTPS only', () => {
    expect(platformOf('https://claude.ai/chat/x')).toBe('Claude');
    expect(platformOf('https://chatgpt.com/c/x')).toBe('ChatGPT');
    expect(platformOf('http://claude.ai/chat/x')).toBeUndefined();
    expect(platformOf('https://claude.ai.evil.example/chat/x')).toBeUndefined();
    expect(conversationIdOf('Claude', '/chat/abc-123')).toBe('abc-123');
    expect(conversationIdOf('Claude', '/new')).toBeUndefined();
  });
  it('accepts a Claude snapshot only on a Claude host', () => {
    expect(isSnapshot(snapshot)).toBe(true);
    expect(isSnapshot({ ...snapshot, website: 'https://chatgpt.com/c/abc-123' })).toBe(false);
    expect(isSnapshot({ ...snapshot, platform: 'ChatGPT' })).toBe(false);
  });
  it('authorizes Claude page highlights by the /chat/ conversation ID', () => {
    const sender = { url: 'https://claude.ai/chat/abc-123', frameId: 0 };
    expect(matchesHighlightSource(snapshot, sender, snapshot.website)).toBe(true);
    expect(matchesHighlightSource(snapshot, sender, 'https://claude.ai/chat/other')).toBe(false);
    expect(
      matchesHighlightSource({ ...snapshot, conversationId: 'other' }, sender, snapshot.website),
    ).toBe(false);
  });
});

describe('ClaudeAdapter (synthetic fixture)', () => {
  function load() {
    document.documentElement.innerHTML = readFileSync(
      'tests/fixtures/claude-synthetic.html',
      'utf8',
    );
    history.replaceState({}, '', '/chat/abc-123');
  }
  it('extracts ordered user and assistant turns without UI controls', () => {
    load();
    const adapter = new ClaudeAdapter();
    const messages = adapter.extractMessages();
    expect(messages.map((m) => [m.id, m.role])).toEqual([
      ['claude-0:user', 'user'],
      ['claude-1:assistant', 'assistant'],
      ['claude-2:user', 'user'],
      ['claude-3:assistant', 'assistant'],
    ]);
    expect(messages[0]!.text).toBe('What is gradient descent?');
    expect(messages[1]!.text).toContain('Gradient descent is an optimization method.');
    expect(messages[1]!.text).toContain('1. Compute the gradient.');
    expect(messages[1]!.text).toContain('w = w - lr * grad');
    expect(messages[1]!.text).not.toMatch(/Copy|Retry|Edit/);
    expect(messages[1]!.content?.blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'code']);
    expect(adapter.getConversationId()).toBe('abc-123');
    expect(adapter.extractTitle()).toBe('Gradient descent basics');
  });
  it('reports the same text for on-page highlights as for capture', () => {
    load();
    const adapter = new ClaudeAdapter();
    const texts = adapter.extractMessages().map((m) => m.text);
    expect(adapter.sourceMessages().map((m) => adapter.sourceText(m.element))).toEqual(texts);
  });
  it('builds a snapshot the worker accepts', async () => {
    load();
    const { snapshotOf } = await import('../src/adapters');
    const value = snapshotOf(new ClaudeAdapter());
    expect(value.website).toBe(`${location.origin}/chat/abc-123`);
    expect(isSnapshot({ ...value, website: 'https://claude.ai/chat/abc-123' })).toBe(true);
  });
});

describe('optional claude.ai content script', () => {
  afterEach(() => vi.unstubAllGlobals());
  function stub(granted: boolean, registered: unknown[]) {
    const api = {
      permissions: { contains: vi.fn().mockResolvedValue(granted) },
      scripting: {
        getRegisteredContentScripts: vi.fn().mockResolvedValue(registered),
        registerContentScripts: vi.fn().mockResolvedValue(undefined),
        unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
        executeScript: vi.fn().mockResolvedValue([]),
      },
      tabs: { query: vi.fn().mockResolvedValue([{ id: 4 }, {}]) },
    };
    vi.stubGlobal('chrome', api);
    return api;
  }
  it('registers and injects into open Claude tabs once access is granted', async () => {
    const api = stub(true, []);
    expect(await syncClaudeContentScript()).toBe(true);
    expect(api.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ matches: ['https://claude.ai/*'], js: ['content.js'] }),
    ]);
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 4 },
      files: ['content.js'],
    });
  });
  it('does nothing without access and unregisters when access is revoked', async () => {
    let api = stub(false, []);
    expect(await syncClaudeContentScript()).toBe(false);
    expect(api.scripting.registerContentScripts).not.toHaveBeenCalled();
    api = stub(false, [{ id: 'ai-notebook-claude' }]);
    await syncClaudeContentScript();
    expect(api.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['ai-notebook-claude'],
    });
  });
  it('does not register twice', async () => {
    const api = stub(true, [{ id: 'ai-notebook-claude' }]);
    await syncClaudeContentScript();
    expect(api.scripting.registerContentScripts).not.toHaveBeenCalled();
  });
});
