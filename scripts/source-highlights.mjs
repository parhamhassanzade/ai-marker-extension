import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPdfText } from './pdf-text.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-source-'));
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const fixture = await readFile('tests/fixtures/chatgpt-semantic.html', 'utf8');
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  );
  const chat = await context.newPage();
  await chat.goto('https://chatgpt.com/c/source-test');
  // ChatGPT opens saved/project chats with client-side navigation. The sender's
  // document URL may remain the original URL even though location has changed.
  await chat.evaluate(() => history.pushState({}, '', '/g/g-p-project/c/old-source-chat'));
  // First highlight works with the notebook panel closed, using a real mouse drag.
  const paragraph = chat.locator('[data-message-id="a1"] p').first();
  await paragraph.waitFor();
  const bounds = await paragraph.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    walker.nextNode();
    const node = walker.currentNode;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    return {
      first: { x: rects[0].x, y: rects[0].y + rects[0].height / 2 },
      last: { x: rects.at(-1).right, y: rects.at(-1).y + rects.at(-1).height / 2 },
    };
  });
  await chat.mouse.move(bounds.first.x, bounds.first.y);
  await chat.mouse.down();
  await chat.mouse.move(bounds.last.x, bounds.last.y, { steps: 20 });
  await chat.mouse.up();
  await expect(chat.locator('#ai-marker-toolbar')).toBeVisible();
  const quote = await chat.evaluate(() => getSelection().toString());
  expect(quote.length).toBeGreaterThan(20);
  await chat.getByRole('button', { name: '📝 Add Note', exact: true }).click();
  await chat
    .getByRole('textbox', { name: 'Highlight note' })
    .fill('Saved from the original ChatGPT page');
  await chat.getByRole('button', { name: '🟢 Definition', exact: true }).click();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await chat.bringToFront();
  await expect
    .poll(async () =>
      panel.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: 'list' })).data.notebooks[0]?.highlights.length,
      ),
    )
    .toBe(1);
  const savedConversation = await panel.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: 'list' })).data.notebooks[0].conversationId,
  );
  expect(savedConversation).toBe('old-source-chat');
  const tabId = await panel.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  const coloredRanges = () =>
    panel.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () =>
              [...CSS.highlights.get('ai-notebook-green')].map((range) => range.toString()),
          })
        )[0].result,
      tabId,
    );
  expect((await coloredRanges()).join('')).toBe(quote);
  await expect(panel.locator('mark[data-highlight-id]')).toHaveText(quote);
  await chat.reload();
  await expect.poll(coloredRanges).toEqual([quote]);
  await mkdir('artifacts', { recursive: true });
  await chat.screenshot({ path: 'artifacts/main-page-highlight.png', fullPage: true });
  const downloading = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Save study PDF', exact: true }).click();
  await (await downloading).saveAs('artifacts/main-page-highlight.pdf');
  expect((await readPdfText('artifacts/main-page-highlight.pdf')).text).toContain(
    'Saved from the original ChatGPT page',
  );
  const notebookId = await panel.evaluate(
    async () => (await chrome.runtime.sendMessage({ type: 'list' })).data.notebooks[0].id,
  );
  await panel.evaluate(
    async (notebookId) => chrome.runtime.sendMessage({ type: 'clear', id: notebookId }),
    notebookId,
  );
  await expect.poll(coloredRanges).toEqual([]);
  console.log(
    'PASS: main-page mouse selection, note, saved notebook/PDF, reload restoration, clear',
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
