import { expect, it } from 'vitest';
import { matchesHighlightSource } from '../src/background/sourceAuthorization';
import type { ConversationSnapshot } from '../src/types';
const snapshot = (website: string, conversationId = 'old-chat') =>
  ({ platform: 'ChatGPT', website, conversationId }) as ConversationSnapshot;
it.each(['/c/old-chat', '/g/g-project/c/old-chat', '/g/g-p-project/c/old-chat'])(
  'accepts old and project chats at %s after same-document navigation',
  (path) => {
    const url = `https://chatgpt.com${path}`;
    expect(
      matchesHighlightSource(
        snapshot(url),
        { url: 'https://chatgpt.com/c/original-chat', frameId: 0 },
        url,
      ),
    ).toBe(true);
  },
);
it('allows temporary chats that acquire a saved URL', () => {
  expect(
    matchesHighlightSource(
      snapshot('https://chatgpt.com/c/old-chat'),
      { url: 'https://chatgpt.com/' },
      'https://chatgpt.com/c/old-chat',
    ),
  ).toBe(true);
  expect(
    matchesHighlightSource(
      snapshot('https://chatgpt.com/', 'temporary:uuid'),
      { url: 'https://chatgpt.com/' },
      'https://chatgpt.com/?temporary-chat=true',
    ),
  ).toBe(true);
});
it('rejects mismatched IDs, other tabs, untrusted origins, and child frames', () => {
  const url = 'https://chatgpt.com/c/old-chat';
  expect(matchesHighlightSource(snapshot(url, 'different'), { url }, url)).toBe(false);
  expect(matchesHighlightSource(snapshot(url), { url }, 'https://chatgpt.com/c/other-chat')).toBe(
    false,
  );
  expect(matchesHighlightSource(snapshot(url), { url: 'https://example.com/' }, url)).toBe(false);
  expect(matchesHighlightSource(snapshot(url), { url, frameId: 1 }, url)).toBe(false);
  expect(matchesHighlightSource(snapshot(url), { url }, undefined)).toBe(false);
});
