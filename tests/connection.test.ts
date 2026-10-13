import { beforeEach, it, expect, vi } from 'vitest';
import {
  ensureContentScript,
  currentConversation,
  isSupportedUrl,
} from '../src/notebook/connection';
const snapshot = {
  platform: 'ChatGPT',
  conversationId: 'c',
  messages: [],
  title: 'Chat',
  website: 'https://chatgpt.com/c/c',
};
let send: ReturnType<typeof vi.fn>;
let inject: ReturnType<typeof vi.fn>;
let query: ReturnType<typeof vi.fn>;
beforeEach(() => {
  send = vi.fn();
  inject = vi.fn().mockResolvedValue([]);
  query = vi.fn().mockResolvedValue([{ id: 7, url: 'https://chatgpt.com/c/c' }]);
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '2.3.0' }) },
    tabs: { sendMessage: send, query },
    scripting: { executeScript: inject },
  });
});
it('injects into a supported already-open tab when no content script is connected', async () => {
  send.mockRejectedValueOnce(new Error('No receiving end')).mockResolvedValueOnce(snapshot);
  expect((await currentConversation()).snapshot).toEqual(snapshot);
  expect(inject).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['content.js'] });
});
it('does not inject an already connected current-version script', async () => {
  send.mockResolvedValue({ version: '2.3.0' });
  await ensureContentScript(7);
  expect(inject).not.toHaveBeenCalled();
});
it('shares concurrent recovery injections for one tab', async () => {
  send.mockRejectedValue(new Error('No receiving end'));
  await Promise.all([ensureContentScript(7), ensureContentScript(7)]);
  expect(inject).toHaveBeenCalledTimes(1);
});
it('does not inject into unsupported or non-HTTPS pages', async () => {
  query.mockResolvedValue([{ id: 7, url: 'https://example.com' }]);
  await expect(currentConversation()).rejects.toThrow(/No ChatGPT conversation/);
  expect(inject).not.toHaveBeenCalled();
  expect(isSupportedUrl('http://chatgpt.com/c/x')).toBe(false);
  expect(isSupportedUrl('https://chatgpt.com.evil.example/c/x')).toBe(false);
});
