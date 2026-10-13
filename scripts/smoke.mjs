import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPdfText } from './pdf-text.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-test-'));
const extensionPath = path.resolve('dist');
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const failures = [];
try {
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).hostname;
  const behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
  expect(behavior.openPanelOnActionClick).toBe(true);
  const chat = await browser.newPage();
  chat.on('pageerror', (e) => failures.push(e.message));
  const fixture = `<!doctype html><html><head><meta charset="UTF-8"><title>Machine Learning Research - ChatGPT</title></head><body style="font:18px/1.7 system-ui;padding:100px 70px"><main><div data-message-author-role="user" data-message-id="q1">How do neural networks learn? café λ Привет 💡</div><div data-message-author-role="assistant" data-message-id="a1"><div class="markdown"><p>Neural networks learn through weight adjustment.</p><p>Gradient descent minimizes loss.</p></div><button>Copy</button></div></main></body></html>`;
  await browser.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  );
  await chat.goto('https://chatgpt.com/c/test-conversation');
  const stored = () =>
    worker.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('ai-notebook', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('notebooks');
        const request = tx.objectStore('notebooks').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      });
    });
  await expect.poll(async () => (await stored()).length).toBe(0);
  const panel = await browser.newPage();
  panel.on('pageerror', (e) => failures.push(e.message));
  await panel.setViewportSize({ width: 430, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await chat.bringToFront();
  await expect(
    panel.getByRole('button', { name: 'Activate Notebook Mode', exact: true }),
  ).toBeEnabled();
  await panel.getByRole('button', { name: 'Activate Notebook Mode', exact: true }).click();
  await expect(panel.getByText('CHAPTER 01', { exact: true })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Pause Notebook Mode', exact: true }),
  ).toBeEnabled();
  const notebookId = (await stored())[0].id;
  expect((await stored())[0].messages).toHaveLength(2);
  await expect(panel.locator('[data-notebook-message-id="a1"]')).toContainText(
    'Gradient descent minimizes loss.',
  );
  async function selectQuote(messageId, text) {
    await panel.evaluate(
      ({ id, text }) => {
        const root = document.querySelector(`[data-notebook-message-id="${id}"]`);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const start = node.textContent.indexOf(text);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + text.length);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          break;
        }
      },
      { id: messageId, text },
    );
    await expect(panel.locator('#ai-marker-toolbar')).toBeVisible();
  }
  await selectQuote('a1', 'weight adjustment');
  await panel.getByRole('button', { name: '📝 Add Note', exact: true }).click();
  await panel
    .getByRole('textbox', { name: 'Highlight note', exact: true })
    .fill('Important definition');
  await panel.getByRole('button', { name: '🟢 Definition', exact: true }).click();
  await expect(panel.locator('mark[data-highlight-id]')).toHaveCount(1);
  expect((await stored())[0].highlights[0].note).toBe('Important definition');
  await panel.getByRole('button', { name: 'Edit note', exact: true }).click();
  await panel
    .getByRole('textbox', { name: 'Edit highlight note', exact: true })
    .fill('Edited definition');
  await panel.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(panel.locator('.user-note')).toContainText('Edited definition');
  // Continuing to chat updates the same notebook with complete new turns.
  await chat.evaluate(() => {
    document
      .querySelector('main')
      .insertAdjacentHTML(
        'beforeend',
        '<div data-message-author-role="user" data-message-id="q2">Explain attention.</div><div data-message-author-role="assistant" data-message-id="a2"><div class="markdown">Attention gives different weights to parts of the input.</div></div>',
      );
  });
  await expect(panel.getByText('CHAPTER 02', { exact: true })).toBeVisible();
  expect((await stored())[0].id).toBe(notebookId);
  expect((await stored())[0].messages).toHaveLength(4);
  await selectQuote('a2', 'different weights');
  await panel.getByRole('button', { name: '🔴 Important', exact: true }).click();
  await expect(panel.locator('mark[data-highlight-id]')).toHaveCount(2);
  await mkdir('artifacts', { recursive: true });
  await panel.screenshot({
    path: 'artifacts/notebook-light.png',
    fullPage: true,
    animations: 'disabled',
  });
  await panel.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(panel.locator('.primary-button')).toHaveCSS(
    'background-color',
    'rgb(177, 204, 149)',
  );
  await panel.screenshot({
    path: 'artifacts/notebook-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  const downloading = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export full PDF', exact: true }).click();
  const download = await downloading;
  await download.saveAs('artifacts/notebook.pdf');
  expect((await readFile('artifacts/notebook.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  const exported = await readPdfText('artifacts/notebook.pdf');
  for (const content of [
    'Neural networks learn through weight adjustment.',
    'Gradient descent minimizes loss.',
    'Explain attention.',
    'Attention gives different weights to parts of the input.',
    'Edited definition',
  ])
    expect(exported.text).toContain(content);
  await panel.getByRole('button', { name: 'Pause Notebook Mode', exact: true }).click();
  await chat.evaluate(() => {
    document
      .querySelector('main')
      .insertAdjacentHTML(
        'beforeend',
        '<div data-message-author-role="user" data-message-id="q3">What is a token?</div><div data-message-author-role="assistant" data-message-id="a3"><div class="markdown">A token is a unit of text.</div></div>',
      );
  });
  expect((await stored())[0].messages).toHaveLength(4);
  await panel.getByRole('button', { name: 'Activate Notebook Mode', exact: true }).click();
  await expect(panel.getByText('CHAPTER 03', { exact: true })).toBeVisible();
  expect((await stored()).length).toBe(1);
  expect((await stored())[0].id).toBe(notebookId);
  await panel.reload();
  await chat.bringToFront();
  await expect(panel.locator('mark[data-highlight-id]')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Clear highlights', exact: true }).click();
  await panel.getByRole('button', { name: 'Clear highlights', exact: true }).last().click();
  await expect(panel.locator('mark[data-highlight-id]')).toHaveCount(0);
  expect((await stored())[0].messages).toHaveLength(6);
  await panel.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(panel.getByText('FINISHED NOTEBOOK', { exact: true })).toBeVisible();
  await chat.reload();
  await panel.reload();
  await chat.bringToFront();
  await expect(panel.getByText('FINISHED NOTEBOOK', { exact: true })).toBeVisible();
  await panel
    .getByRole('button', { name: 'New notebook for this conversation', exact: true })
    .click();
  await expect.poll(async () => (await stored()).length).toBe(2);
  expect(failures).toEqual([]);
  console.log(
    'Chromium smoke passed: explicit activation, full chapter view, in-notebook highlighting, note editing, live turns, IndexedDB persistence, themes, full PDF, pause/resume, finish, and new notebook.',
  );
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
