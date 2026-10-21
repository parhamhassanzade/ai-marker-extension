import { chromium, expect } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Chromium's runtime permission prompt cannot be automated. Load a copy of the
// package with claude.ai pre-granted, so registration, capture, and highlighting
// run exactly as they do after the user clicks "Allow claude.ai".
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-notebook-claude-'));
const extension = path.join(temporary, 'extension');
await cp('dist', extension, { recursive: true });
const manifest = JSON.parse(await readFile(`${extension}/manifest.json`, 'utf8'));
manifest.host_permissions.push(...manifest.optional_host_permissions);
await writeFile(`${extension}/manifest.json`, JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  await expect
    .poll(() =>
      worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length),
    )
    .toBe(1);
  const fixture = await readFile('tests/fixtures/claude-synthetic.html', 'utf8');
  await context.route('https://claude.ai/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  );
  const chat = await context.newPage();
  await chat.goto('https://claude.ai/chat/claude-smoke');
  await chat.waitForFunction(() => document.querySelector('#ai-marker-toolbar'));
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: 'https://claude.ai/*' }))[0].id,
  );
  const notebook = await context.newPage();
  await notebook.goto(`chrome-extension://${id}/sidepanel.html?sourceTab=${tabId}`);
  await expect(notebook.getByText('Gradient descent basics')).toBeVisible();
  await notebook.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await expect(notebook.getByText(/Claude conversation detected/)).toBeVisible();
  await notebook.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(notebook.locator('[data-notebook-message-id]')).toHaveCount(4);
  await expect(notebook.locator('[data-notebook-message-id="claude-1:assistant"]')).toContainText(
    'w = w - lr * grad',
  );
  // Highlight a passage on the Claude page itself.
  await chat.bringToFront();
  await chat.evaluate(() => {
    const node = document.querySelector('.font-claude-response p').firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 'Gradient descent'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await chat.getByRole('button', { name: '🟢 Definition', exact: true }).click();
  const saved = await notebook.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'list' });
    const book = result.data.notebooks[0];
    return {
      platform: book.platform,
      conversationId: book.conversationId,
      messages: book.messages.length,
      highlight: book.highlights[0] && [book.highlights[0].messageId, book.highlights[0].text],
    };
  });
  expect(saved).toEqual({
    platform: 'Claude',
    conversationId: 'claude-smoke',
    messages: 4,
    highlight: ['claude-1:assistant', 'Gradient descent'],
  });
  await expect
    .poll(() =>
      chat.evaluate(() => [...(CSS.highlights.get('ai-notebook-green') ?? [])].map(String)),
    )
    .toEqual(['Gradient descent']);
  console.log(
    'PASS Claude: optional-host content script registration, notebook tab connection, capture of 4 turns with rich content, on-page highlight saved and painted',
  );
} finally {
  await context.close();
  await rm(temporary, { recursive: true, force: true });
}
