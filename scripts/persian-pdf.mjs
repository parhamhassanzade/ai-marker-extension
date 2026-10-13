import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPdfText } from './pdf-text.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-persian-'));
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
  const notebook = JSON.parse(await readFile('tests/fixtures/persian-notebook.json', 'utf8'));
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.evaluate(async (notebook) => {
    const snapshot = {
      platform: notebook.platform,
      conversationId: notebook.conversationId,
      title: notebook.title,
      website: notebook.website,
      messages: notebook.messages,
    };
    const result = await chrome.runtime.sendMessage({ type: 'activate', snapshot });
    if (!result.ok) throw new Error(result.error);
    const id = result.data.notebooks[0].id;
    for (const highlight of notebook.highlights) {
      const saved = await chrome.runtime.sendMessage({ type: 'annotate', id, highlight });
      if (!saved.ok) throw new Error(saved.error);
    }
  }, notebook);
  await expect(panel.getByRole('button', { name: 'Export full PDF', exact: true })).toBeEnabled();
  const downloading = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export full PDF', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('دفتر یادگیری ماشین.pdf');
  await mkdir('output/pdf', { recursive: true });
  await download.saveAs('output/pdf/persian-notebook.pdf');
  const pdf = await readPdfText('output/pdf/persian-notebook.pdf');
  expect(pdf.pages).toBeGreaterThan(1);
  expect(pdf.text).toContain('Machine Learning');
  expect(pdf.text).toContain('Gradient Descent');
  expect(pdf.text).toContain('۲۰۲۶');
  expect(pdf.text).not.toMatch(/\[U\+0?6[0-9A-F]{2}\]/);
  console.log(
    'PASS: bundled Persian font, native extension PDF download, mixed English/digits, three colors, long conversation, Persian filename',
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
