import { chromium, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPdfText } from './pdf-text.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-ux-'));
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  reducedMotion: 'reduce',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  let fixture = await readFile('tests/fixtures/chatgpt-semantic.html', 'utf8');
  fixture = fixture
    .replace('Learning Machine Learning - ChatGPT', 'CAMUS Dataset Analysis - ChatGPT')
    .replace('What is machine learning?', 'What is CAMUS?')
    .replace(
      'Machine learning is a field of AI that learns patterns from data.',
      'CAMUS is a cardiac ultrasound dataset used to study segmentation.',
    )
    .replace(
      'It improves predictions through experience.',
      'It contains annotated images for training and evaluating deep learning models.',
    );
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  );
  const chat = await context.newPage();
  await chat.goto('https://chatgpt.com/c/knowledge');
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 1050 });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await chat.bringToFront();
  await panel.getByRole('button', { name: 'Create notebook', exact: true }).click();
  const home = panel.getByRole('region', { name: 'Notebook home' });
  await expect(home).toBeVisible();
  await expect(home.getByRole('heading', { name: 'Your overview' })).toBeVisible();
  await expect(home.getByRole('heading', { name: 'Topics' })).toBeVisible();
  await home.getByRole('button', { name: 'Edit notebook summary' }).click();
  await home
    .getByRole('textbox', { name: 'Notebook summary' })
    .fill('A study notebook about cardiac imaging datasets and segmentation research.');
  await home.getByRole('button', { name: 'Save overview' }).click();
  await home.getByRole('button', { name: '01 What is CAMUS?', exact: true }).click();
  const read = panel.getByRole('region', { name: 'Reading view' });
  await expect(read).toBeVisible();
  await expect(read.getByText('AI response', { exact: true }).first()).toBeVisible();
  await read.locator('[data-notebook-message-id="a1"]').scrollIntoViewIfNeeded();
  await panel.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await panel.evaluate(() => {
    const root = document.querySelector('[data-notebook-message-id="a1"]');
    const node = root.querySelector('span').firstChild;
    const quote = 'cardiac ultrasound dataset';
    const start = node.textContent.indexOf(quote);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + quote.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await panel.getByRole('button', { name: '🟡 Highlight', exact: true }).click();
  await panel.getByRole('button', { name: /^Highlights/ }).click();
  const library = panel.getByRole('region', { name: 'Your highlights' });
  await expect(library.locator('.annotation')).toHaveCount(1);
  await library.getByRole('button', { name: 'Edit note', exact: true }).click();
  await library
    .getByRole('textbox', { name: 'Edit highlight note' })
    .fill('Compare this with the dataset in my thesis.');
  await library.getByRole('textbox', { name: 'Highlight tags' }).fill('thesis, medical imaging');
  await library.getByRole('button', { name: 'Save note', exact: true }).click();
  await library.getByRole('button', { name: 'Bookmark highlight', exact: true }).click();
  await expect(
    library.getByRole('button', { name: 'Remove bookmark', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await library.getByRole('textbox', { name: 'Search highlights' }).fill('thesis');
  await expect(library.locator('.annotation')).toHaveCount(1);
  await library.getByRole('textbox', { name: 'Search highlights' }).fill('absent word');
  await expect(library.locator('.annotation')).toHaveCount(0);
  await library.getByRole('textbox', { name: 'Search highlights' }).fill('');
  await library.getByRole('combobox', { name: 'Filter by tag' }).selectOption('medical imaging');
  await expect(library.locator('.annotation')).toHaveCount(1);
  await library.getByRole('button', { name: 'Bookmarked', exact: true }).click();
  await expect(library.locator('.annotation')).toHaveCount(1);
  await mkdir('artifacts', { recursive: true });
  await panel.screenshot({ path: 'artifacts/knowledge-highlights.png', fullPage: true });
  await library.getByRole('button', { name: 'Go to passage', exact: true }).click();
  await expect(read.locator('mark[data-highlight-id]')).toHaveText('cardiac ultrasound dataset');
  await panel.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(home.locator('.insight-preview')).toContainText('cardiac ultrasound dataset');
  await panel.screenshot({ path: 'artifacts/knowledge-home.png', fullPage: true });
  await panel.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(panel.locator('html')).toHaveClass(/dark/);
  await panel.screenshot({ path: 'artifacts/knowledge-home-dark.png', fullPage: true });
  await panel.getByRole('button', { name: 'Switch to light theme' }).click();
  await panel.reload();
  await chat.bringToFront();
  await expect(home).toBeVisible();
  await expect(home).toContainText('A study notebook about cardiac imaging');
  await panel.getByRole('button', { name: /^Highlights/ }).click();
  await expect(library).toContainText('Compare this with the dataset in my thesis.');
  await expect(library.getByRole('button', { name: 'Remove bookmark', exact: true })).toBeVisible();
  const downloading = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Save study PDF', exact: true }).click();
  await mkdir('output/pdf', { recursive: true });
  await (await downloading).saveAs('output/pdf/study-notebook.pdf');
  const pdf = await readPdfText('output/pdf/study-notebook.pdf');
  expect(pdf.pages).toBeGreaterThanOrEqual(5);
  for (const text of [
    'Contents',
    'Notebook overview',
    'Your saved highlights',
    'cardiac ultrasound dataset',
    'Compare this with the dataset in my thesis.',
    '#thesis',
    'Bookmarked',
    'A study notebook about cardiac imaging',
  ])
    expect(pdf.text).toContain(text);
  // A late chapter can be reached without manually loading every preceding one.
  const tabId = await panel.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  await panel.evaluate(
    async ({ tabId }) => {
      const result = await chrome.runtime.sendMessage({ type: 'list' });
      const notebook = result.data.notebooks[0];
      const messages = [...notebook.messages];
      for (let i = 3; i <= 25; i++) {
        messages.push(
          { id: `q${i}`, role: 'user', text: `Research question ${i}` },
          { id: `a${i}`, role: 'assistant', text: `Research answer ${i}` },
        );
      }
      await chrome.runtime.sendMessage({
        type: 'sync',
        snapshot: {
          platform: notebook.platform,
          conversationId: notebook.conversationId,
          website: notebook.website,
          title: notebook.title,
          messages,
        },
      });
    },
    { tabId },
  );
  await panel.getByRole('button', { name: 'Home', exact: true }).click();
  await home.getByRole('button', { name: '25 Research question 25', exact: true }).click();
  await expect(read.locator('[data-notebook-message-id="a25"]')).toBeVisible();
  console.log(
    'PASS knowledge notebook: Home/Read/Highlights, overview, source-linked insights, notes, tags, bookmark/search/filter persistence, late chapter navigation, study PDF cover/contents/annotations',
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
