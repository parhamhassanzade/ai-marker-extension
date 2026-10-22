import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// A long ChatGPT conversation: many turns plus one answer whose syntax-
// highlighted code block exceeds the structured-content budget. The page must
// stay usable: capture continues, and highlights and notes still save.
const turns = Number(process.env.TURNS ?? 150);
const paragraph = (i, p) =>
  `<p>Answer ${i} paragraph ${p}: gradient descent updates the weights against the gradient of the loss, step by step, until the model converges.</p>`;
const code = Array.from(
  { length: 3000 },
  (_, i) =>
    `<span class="hljs-keyword">const</span> <span class="hljs-variable">v${i}</span> = <span class="hljs-number">${i}</span>;\n`,
).join('');
const articles = [];
for (let i = 0; i < turns; i++) {
  articles.push(
    `<article data-testid="conversation-turn-${i * 2}" data-message-id="q${i}"><h5 class="sr-only">You said:</h5><div data-message-author-role="user" data-message-id="q${i}"><div class="whitespace-pre-wrap">Question number ${i}?</div></div></article>`,
    `<article data-testid="conversation-turn-${i * 2 + 1}" data-message-id="a${i}"><h6 class="sr-only">ChatGPT said:</h6><div data-message-author-role="assistant" data-message-id="a${i}"><div class="prose">${[0, 1, 2, 3].map((p) => paragraph(i, p)).join('')}${i === 10 ? `<pre><code class="language-js">${code}</code></pre>` : ''}</div></div><button>Copy</button></article>`,
  );
}
const fixture = `<!doctype html><html><head><title>Long study - ChatGPT</title></head><body><main><div role="region">${articles.join('')}</div></main></body></html>`;
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-large-'));
const extension = path.resolve(process.env.EXTENSION_DIR ?? 'dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  );
  const chat = await context.newPage();
  await chat.goto('https://chatgpt.com/c/large-chat');
  await chat.waitForFunction(() => document.querySelector('#ai-marker-toolbar'));
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))[0].id,
  );
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html?sourceTab=${tabId}`);
  await panel.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await expect(panel.locator('.capture-notice')).toContainText(`${turns * 2} messages imported`, {
    timeout: 60000,
  });
  const list = () =>
    panel.evaluate(
      async () => (await chrome.runtime.sendMessage({ type: 'list' })).data.notebooks[0],
    );
  const captured = await list();
  const big = captured.messages.find((m) => m.id === 'a10');
  if (!big.text.includes('const v2999 = 2999;')) throw new Error('Large code answer text missing');
  // Main-thread blocking, measured in the page (content scripts share the thread).
  await chat.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) =>
      window.__longTasks.push(...list.getEntries().map((e) => e.duration)),
    ).observe({ type: 'longtask', buffered: false });
  });
  async function highlight(messageId, words, note) {
    await chat.bringToFront();
    const started = Date.now();
    await chat.evaluate(
      ({ messageId, words }) => {
        const p = document.querySelector(`[data-message-id="${messageId}"] p`);
        const node = p.firstChild;
        const range = document.createRange();
        const start = node.textContent.indexOf(words);
        range.setStart(node, start);
        range.setEnd(node, start + words.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      },
      { messageId, words },
    );
    await chat.getByRole('button', { name: '📝 Add Note', exact: true }).click({ timeout: 5000 });
    const toolbarMs = Date.now() - started;
    await chat.getByRole('textbox', { name: 'Highlight note' }).fill(note);
    await chat.getByRole('button', { name: '🟢 Definition', exact: true }).click();
    await expect
      .poll(async () => (await list()).highlights.some((h) => h.note === note), {
        timeout: 15000,
      })
      .toBe(true);
    return toolbarMs;
  }
  const firstToolbarMs = await highlight(`a${turns - 1}`, 'gradient descent', 'First note');
  // Stream a reply for a while: the observer and capture run on every chunk.
  await chat.evaluate(async () => {
    const target = document.querySelector('[data-message-id] .prose:last-of-type');
    const live = document.querySelectorAll('[data-message-author-role="assistant"] .prose');
    const prose = live[live.length - 1] ?? target;
    const p = document.createElement('p');
    prose.append(p);
    for (let i = 0; i < 80; i++) {
      p.textContent += ` streamed chunk ${i}`;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
  await expect
    .poll(async () => (await list()).messages.at(-1).text.includes('streamed chunk 79'), {
      timeout: 30000,
    })
    .toBe(true);
  const secondToolbarMs = await highlight(
    'a3',
    'updates the weights',
    'Second note after streaming',
  );
  const longTasks = await chat.evaluate(() => window.__longTasks);
  const result = {
    turns,
    messages: (await list()).messages.length,
    firstToolbarMs,
    secondToolbarMs,
    longTasks: longTasks.length,
    longestTaskMs: Math.round(Math.max(0, ...longTasks)),
    blockedMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
  };
  console.log('Large chat', result);
  console.log(
    `PASS large chat: ${result.messages} messages incl. an over-budget code answer captured; highlights with notes saved before and after 8 s of streaming`,
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
