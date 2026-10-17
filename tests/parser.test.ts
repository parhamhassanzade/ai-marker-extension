import { it, expect } from 'vitest';
import { ChatGPTAdapter } from '../src/adapters/ChatGPTAdapter';
it('captures only user questions and assistant answer bodies with stable message ids', () => {
  document.body.innerHTML =
    '<div data-message-author-role="user" data-message-id="q">Explain gradients</div><div data-message-author-role="assistant" data-message-id="a"><div class="markdown"><p>Minimize loss.</p><pre>code()</pre></div><button>Copy</button></div>';
  const parser = new ChatGPTAdapter();
  expect(parser.extractMessages()).toMatchObject([
    { id: 'q', role: 'user', text: 'Explain gradients' },
    { id: 'a', role: 'assistant', text: 'Minimize loss.\n\ncode()' },
  ]);
});

it('extracts available timestamps and absolute platform turn positions', () => {
  document.body.innerHTML =
    '<article data-testid="conversation-turn-12"><div data-message-author-role="assistant" data-message-id="stable"><time datetime="2026-10-13T10:30:00Z"></time><div class="markdown">Full answer.</div></div></article>';
  expect(new ChatGPTAdapter().extractMessages()[0]).toMatchObject({
    id: 'stable',
    role: 'assistant',
    text: 'Full answer.',
    order: 12,
    timestamp: '2026-10-13T10:30:00Z',
  });
});

it('keeps paragraphs, bullets, numbering and code while stripping hidden content and controls', () => {
  document.body.innerHTML =
    '<main><article data-turn="assistant" data-testid="conversation-turn-4"><h5>ChatGPT said:</h5><div><h2>Overview</h2><p>First paragraph.</p><p>Second paragraph.</p><ul><li>One</li><li>Two</li></ul><ol start="3"><li>Third</li></ol><pre><button>Copy code</button><code>const x = 1;\n  console.log(x);</code></pre><p hidden>Hidden secret</p><div aria-hidden="true">Navigation</div><button>Regenerate</button></div></article></main>';
  const text = new ChatGPTAdapter().extractMessages()[0]!.text;
  expect(text).toContain('Overview\n\nFirst paragraph.\n\nSecond paragraph.');
  expect(text).toContain('• One');
  expect(text).toContain('• Two');
  expect(text).toContain('3. Third');
  expect(text).toContain('const x = 1;\n  console.log(x);');
  for (const ui of ['ChatGPT said', 'Copy code', 'Hidden secret', 'Navigation', 'Regenerate'])
    expect(text).not.toContain(ui);
});
it('deduplicates a turn wrapper and its nested explicit role and keeps streaming IDs stable', () => {
  document.body.innerHTML =
    '<main><article data-testid="conversation-turn-5" data-turn="assistant"><h5>ChatGPT said:</h5><div data-message-author-role="assistant" data-message-id="stable"><div data-testid="message-content">Partial</div></div></article></main>';
  const adapter = new ChatGPTAdapter();
  const first = adapter.extractMessages();
  expect(first).toHaveLength(1);
  document.querySelector('[data-testid="message-content"]')!.textContent =
    'Final completed answer.';
  expect(adapter.extractMessages()[0]?.id).toBe(first[0]?.id);
  expect(adapter.extractMessages()[0]?.text).toBe('Final completed answer.');
});
it('imports all 50 already loaded messages in source order', () => {
  document.body.innerHTML =
    '<main>' +
    Array.from(
      { length: 50 },
      (_, i) =>
        `<article data-testid="conversation-turn-${i}" data-turn="${i % 2 ? 'assistant' : 'user'}"><p>Loaded message ${i}</p><button>Copy</button></article>`,
    ).join('') +
    '</main>';
  const messages = new ChatGPTAdapter().extractMessages();
  expect(messages).toHaveLength(50);
  expect(messages.map((m) => m.order)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  expect(messages[49]?.text).toBe('Loaded message 49');
});
