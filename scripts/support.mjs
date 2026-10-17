import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPdfText } from './pdf-text.mjs';

const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-support-'));
const extensionPath = path.resolve('dist');
const browser = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const errors = [],
  donationRequests = [];
browser.on('request', (request) => {
  if (request.url().includes('ko-fi.com')) donationRequests.push(request.url());
});
try {
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  await browser.route('https://chatgpt.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><title>Support test - ChatGPT</title></head><body><main></main></body></html>',
    }),
  );
  const chat = await browser.newPage();
  await chat.goto('https://chatgpt.com/');
  const panel = await browser.newPage();
  panel.on('pageerror', (error) => errors.push(error.message));
  await panel.addInitScript(() => {
    const originalFetch = window.fetch;
    window.failNextFontLoad = false;
    window.fetch = function (...args) {
      if (window.failNextFontLoad && String(args[0]).includes('NotoSans')) {
        window.failNextFontLoad = false;
        return Promise.reject(new Error('Simulated font download failure'));
      }
      return originalFetch.apply(this, args);
    };
  });
  await panel.setViewportSize({ width: 430, height: 1000 });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await chat.bringToFront();
  const mainLink = panel.locator('.main-support a');
  await expect(mainLink).toBeVisible();
  await expect(mainLink).toHaveAttribute('href', 'https://ko-fi.com/parham3752');
  await panel.setViewportSize({ width: 280, height: 1000 });
  await expect(mainLink).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.setViewportSize({ width: 430, height: 1000 });
  const note = panel.getByRole('complementary', { name: 'Optional project support' });
  const save = panel.getByRole('button', { name: 'Save study PDF', exact: true });
  const state = () =>
    panel.evaluate(
      async () => (await chrome.runtime.sendMessage({ type: 'getSupportState' })).data,
    );
  await expect(note).toHaveCount(0);
  await panel.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await expect(save).toBeDisabled();
  expect((await state()).successfulPdfExports).toBe(0);
  await chat.evaluate(() => {
    document.querySelector('main').innerHTML =
      '<div data-message-author-role="user" data-message-id="q">Explain learning.</div><div data-message-author-role="assistant" data-message-id="a"><p>Practice helps you learn.</p></div>';
  });
  await expect(save).toBeEnabled();
  await panel.evaluate(() => {
    window.failNextFontLoad = true;
  });
  await save.click();
  await expect(panel.getByRole('alert')).toContainText('Simulated font download failure');
  expect((await state()).successfulPdfExports).toBe(0);
  await expect(note).toHaveCount(0);

  async function exportOne(count) {
    const downloading = panel.waitForEvent('download');
    await save.click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    expect((await readPdfText(await download.path())).text).toContain('Support on Ko-fi');
    await expect(
      panel.getByRole('status').filter({ hasText: 'Study PDF exported.' }),
    ).toBeVisible();
    await expect.poll(async () => (await state()).successfulPdfExports).toBe(count);
  }
  for (const count of [1, 2]) {
    await exportOne(count);
    await expect(note).toHaveCount(0);
  }
  await exportOne(3);
  await expect(note).toBeVisible();
  await expect(note).toContainText(
    "Glad AI Notebook is useful! If you'd like, you can support it on Ko-fi.",
  );
  await panel.getByText('About AI Notebook', { exact: true }).click();
  const links = panel.getByRole('link', {
    name: 'Support AI Notebook on Ko-fi (opens in a new tab)',
  });
  await expect(links).toHaveCount(3);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('href', 'https://ko-fi.com/parham3752');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  const summary = panel.locator('.about-support summary');
  await summary.focus();
  await panel.keyboard.press('Tab');
  await expect(panel.locator('.about-support a')).toBeFocused();
  await expect(panel.locator('.about-support a')).toHaveCSS('outline-style', 'solid');
  await expect(panel.locator('.about-support a')).toHaveCSS('outline-width', '2px');
  await mkdir('artifacts', { recursive: true });
  await panel.locator('.app-header').screenshot({ path: 'artifacts/support-header-light.png' });
  await note.screenshot({ path: 'artifacts/support-light.png' });
  await panel.getByRole('button', { name: 'Switch to dark theme' }).click();
  await panel.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  await panel.locator('.app-header').screenshot({ path: 'artifacts/support-header-dark-rtl.png' });
  await note.screenshot({ path: 'artifacts/support-dark-rtl.png' });
  const fits = await note.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  await panel.getByRole('button', { name: "Don't show again", exact: true }).click();
  await expect(note).toHaveCount(0);
  expect((await state()).dismissed).toBe(true);
  await panel.reload();
  await chat.bringToFront();
  await expect(save).toBeEnabled();
  await expect(note).toHaveCount(0);
  expect((await state()).dismissed).toBe(true);
  await exportOne(4);
  await expect(note).toHaveCount(0);
  expect((await state()).dismissed).toBe(true);
  expect(donationRequests).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    'PASS support: empty/failed exports excluded, third-success inline note, safe links, keyboard focus, themes/RTL, persistent dismissal, no Ko-fi requests.',
  );
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
