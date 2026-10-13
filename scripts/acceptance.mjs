import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPdfText, normalizeText } from './pdf-text.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-acceptance-'));
const extensionPath = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).hostname;
  const fixture = await readFile('tests/fixtures/chatgpt-semantic.html', 'utf8');
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  );
  const chat = await context.newPage();
  await chat.goto('https://chatgpt.com/c/acceptance');
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 430, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await chat.bringToFront();
  // Simulate a tab predating installation: remove the capture listener in the
  // extension's isolated world, then let the panel recover via scripting API.
  const tabId = await panel.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  await panel.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        globalThis.__aiNotebookCapture?.dispose();
        delete globalThis.__aiNotebookCapture;
      },
    });
  }, tabId);
  await expect(
    panel.getByRole('button', { name: 'Activate Notebook Mode', exact: true }),
  ).toBeEnabled();
  await panel.getByRole('button', { name: 'Activate Notebook Mode', exact: true }).click();
  await expect(panel.locator('.capture-notice')).toContainText('4 messages imported');
  await expect(panel.locator('[data-notebook-message-id]')).toHaveCount(4);
  const notebook = await panel.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'list' });
    return result.data.notebooks[0];
  });
  expect(notebook.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(notebook.highlights).toHaveLength(0);
  const expected = [
    'What is machine learning?',
    'Machine learning is a field of AI that learns patterns from data. It improves predictions through experience.',
    'What is supervised learning?',
    'Supervised learning uses labeled data to learn a mapping from inputs to outputs. The labels provide correct target answers during training.',
  ];
  for (let i = 0; i < expected.length; i++)
    expect(normalizeText(notebook.messages[i].text)).toBe(expected[i]);
  console.log('Acceptance extraction diagnostics', {
    title: notebook.title,
    count: notebook.messages.length,
    messages: notebook.messages.map((m) => ({ role: m.role, preview: m.text.slice(0, 100) })),
  });
  async function exportAndVerify(file) {
    const downloading = panel.waitForEvent('download');
    await panel.getByRole('button', { name: 'Export full PDF', exact: true }).click();
    await (await downloading).saveAs(file);
    const result = await readPdfText(file);
    let previous = -1;
    for (const content of expected) {
      const position = result.text.indexOf(content);
      expect(position, `Missing full message in ${file}: ${content}`).toBeGreaterThan(previous);
      previous = position;
    }
    expect(result.text).not.toMatch(/Copy message|Rate response|Regenerate|Navigation decoy/);
    return result;
  }
  await mkdir('artifacts', { recursive: true });
  const plain = await exportAndVerify('artifacts/acceptance-no-highlights.pdf');
  await panel.locator('[data-notebook-message-id="a2"]').scrollIntoViewIfNeeded();
  await panel.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await panel.evaluate(() => {
    const root = document.querySelector('[data-notebook-message-id="a2"]');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent;
      const start = text.indexOf('uses labeled data');
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, start);
      range.setEnd(walker.currentNode, start + 17);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      break;
    }
  });
  await expect(panel.locator('#ai-marker-toolbar')).toBeVisible();
  await panel.getByRole('button', { name: '📝 Add Note', exact: true }).click();
  await panel
    .getByRole('textbox', { name: 'Highlight note', exact: true })
    .fill('Important definition');
  await panel.getByRole('button', { name: '🟢 Definition', exact: true }).click();
  await expect(panel.locator('mark[data-highlight-id]')).toHaveText('uses labeled data');
  const annotated = await exportAndVerify('artifacts/acceptance-annotated.pdf');
  expect(annotated.text).toContain('Important definition');
  expect(annotated.text.lastIndexOf('uses labeled data')).toBeGreaterThan(
    annotated.text.indexOf(expected[3]),
  );
  await panel.getByRole('button', { name: 'Use yellow highlighter', exact: true }).click();
  await panel.locator('[data-notebook-message-id="a1"]').scrollIntoViewIfNeeded();
  await panel.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const drag = await panel.evaluate(() => {
    const root = document.querySelector('[data-notebook-message-id="a1"]');
    const range = document.createRange();
    range.selectNodeContents(root);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5);
    const first = rects[0],
      last = rects.at(-1);
    return {
      start: { x: first.left + 1, y: first.top + first.height / 2 },
      end: { x: last.right - 1, y: last.top + last.height / 2 },
    };
  });
  await panel.mouse.move(drag.start.x, drag.start.y);
  await panel.mouse.down();
  await panel.mouse.move(drag.end.x, drag.end.y, { steps: 12 });
  await panel.mouse.up();
  await expect(panel.locator('mark.highlight-yellow')).toHaveCount(1);
  await expect(panel.locator('mark.highlight-yellow')).toHaveText(notebook.messages[1].text);
  await panel.getByRole('button', { name: 'Use red highlighter', exact: true }).click();
  await panel.locator('[data-notebook-message-id="a2"]').scrollIntoViewIfNeeded();
  await panel.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await panel.evaluate(() => {
    const root = document.querySelector('[data-notebook-message-id="a2"]');
    const quote = 'The labels provide correct target answers during training.';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const start = walker.currentNode.textContent.indexOf(quote);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, start);
      range.setEnd(walker.currentNode, start + quote.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      break;
    }
  });
  await expect(panel.locator('mark.highlight-red')).toHaveCount(1);
  await exportAndVerify('artifacts/acceptance-colored-highlights.pdf');
  await panel.screenshot({
    path: 'artifacts/acceptance-notebook.png',
    fullPage: true,
    animations: 'disabled',
  });
  await writeFile(
    'artifacts/acceptance-results.json',
    JSON.stringify(
      {
        title: notebook.title,
        messageCount: 4,
        unannotated: {
          file: 'acceptance-no-highlights.pdf',
          pages: plain.pages,
          verifiedMessages: expected,
        },
        annotated: {
          file: 'acceptance-annotated.pdf',
          pages: annotated.pages,
          verifiedMessages: expected,
          highlight: 'uses labeled data',
          note: 'Important definition',
        },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Acceptance passed: all four full messages appear in order in BOTH downloaded PDFs; annotation and note appear under the second answer. Existing-tab reconnection also passed.',
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
