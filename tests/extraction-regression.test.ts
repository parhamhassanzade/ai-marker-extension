import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { ChatGPTAdapter } from '../src/adapters/ChatGPTAdapter';
it('imports the full existing four-message conversation without legacy role attributes', () => {
  document.documentElement.innerHTML = readFileSync('tests/fixtures/chatgpt-semantic.html', 'utf8');
  console.log(
    'Legacy extraction count:',
    document.querySelectorAll('[data-message-author-role]').length,
  );
  const adapter = new ChatGPTAdapter();
  const messages = adapter.extractMessages();
  console.log('Extraction diagnostics', {
    title: adapter.extractTitle(),
    count: messages.length,
    messages: messages.map((m) => ({ role: m.role, preview: m.text.slice(0, 100) })),
  });
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(messages[3]?.text).toContain('Supervised learning uses labeled data');
});

it('captures the observed live ChatGPT search-unit layout and skips an earlier hidden main', () => {
  document.documentElement.innerHTML = readFileSync(
    'tests/fixtures/chatgpt-live-layout.html',
    'utf8',
  );
  const messages = new ChatGPTAdapter().extractMessages();
  expect(messages.map((m) => m.id)).toEqual(['live-q1', 'live-a1', 'live-q2', 'live-a2']);
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(messages.map((m) => m.text)).toEqual([
    'test',
    'Test received successfully.',
    'whats up',
    'Not much — I’m here and ready. What are you working on?',
  ]);
});
