import { chromium, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-merged-'));
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
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
  await chat.goto('https://chatgpt.com/c/arc-chat');
  const launcher = await context.newPage();
  await launcher.goto(`chrome-extension://${id}/sidepanel.html`);
  const source = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    return { tabId: tab.id, windowId: tab.windowId };
  });
  const launch = () =>
    launcher.evaluate(
      (source) => chrome.runtime.sendMessage({ type: 'openNotebookSurface', ...source }),
      source,
    );
  expect(
    await worker.evaluate(() => chrome.runtime.getManifest().action.default_popup),
  ).toBeUndefined();
  expect(await launch()).toMatchObject({ ok: true, surface: 'side-panel' });
  await worker.evaluate(async (windowId) => chrome.sidePanel.close({ windowId }), source.windowId);
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
      ),
    )
    .toBe(0);
  // Simulate a Chromium shell exposing an API which silently does nothing.
  await worker.evaluate(() => {
    chrome.sidePanel.open = async () => {};
  });
  let opened = context.waitForEvent('page');
  expect(await launch()).toMatchObject({ ok: true, surface: 'window' });
  const panel = await opened;
  await expect(panel.getByRole('button', { name: 'Create notebook', exact: true })).toBeEnabled();
  expect(new URL(panel.url()).searchParams.get('sourceWindow')).toBe(String(source.windowId));
  await panel.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await panel.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(panel.locator('[data-notebook-message-id]')).toHaveCount(4);
  await panel.getByText('Notebook settings', { exact: true }).click();
  await panel.getByLabel('Open notebook in:').selectOption('window');
  await expect(panel.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await panel.reload();
  await panel.getByText('Notebook settings', { exact: true }).click();
  await expect(panel.getByLabel('Open notebook in:')).toHaveValue('window');
  const count = context.pages().length;
  await worker.evaluate(() => {
    chrome.sidePanel.open = async () => {
      throw new Error('Panel must be bypassed');
    };
  });
  expect(await launch()).toMatchObject({ ok: true, surface: 'window' });
  expect(context.pages()).toHaveLength(count);
  await chat.evaluate(() => history.pushState({}, '', '/g/g-project/c/arc-old'));
  await expect(panel.getByRole('button', { name: 'Create notebook', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await expect
    .poll(() =>
      panel.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: 'list' })).data.notebooks.at(-1).conversationId,
      ),
    )
    .toBe('arc-old');
  await panel.close();
  await launcher.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'setNotebookSurface', value: 'auto' }),
  );
  opened = context.waitForEvent('page');
  expect(await launch()).toMatchObject({ ok: true, surface: 'window' });
  await (await opened).close();
  await worker.evaluate(() => {
    chrome.windows.create = async () => {
      throw new Error('Windows unsupported');
    };
  });
  opened = context.waitForEvent('page');
  expect(await launch()).toMatchObject({ ok: true, surface: 'window' });
  const tabFallback = await opened;
  expect(await tabFallback.evaluate(async () => (await chrome.windows.getCurrent()).type)).toBe(
    'normal',
  );
  await expect(tabFallback.getByRole('link', { name: 'Open source conversation' })).toHaveAttribute(
    'href',
    'https://chatgpt.com/g/g-project/c/arc-old',
  );
  await tabFallback.close();
  // Orion on iPad: the notebook is a plain tab with no source parameters, and
  // URL-pattern tab queries are unavailable. Only content-script hellos remain.
  await worker.evaluate(() => {
    chrome.tabs.query = async () => {
      throw new Error('Tab queries unsupported');
    };
  });
  const orion = await context.newPage();
  await orion.goto(`chrome-extension://${id}/sidepanel.html`);
  await orion.bringToFront();
  // arc-old already collects into a notebook, so its mode button pauses updates.
  await expect(orion.getByRole('button', { name: 'Pause updates', exact: true })).toBeEnabled();
  await expect(orion.locator('.connection-notice')).toHaveCount(0);
  await expect(orion.getByText('Which conversation?')).toHaveCount(0);
  const second = await context.newPage();
  await second.goto('https://chatgpt.com/c/arc-second');
  await orion.bringToFront();
  const picker = orion.getByLabel('Which conversation?');
  await expect(picker.locator('option')).toHaveCount(2);
  const secondTab = await orion.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'listSourceTabs' });
    return result.tabs.find((tab) => tab.url.endsWith('/c/arc-second')).tabId;
  });
  await picker.selectOption(String(secondTab));
  await expect
    .poll(() => new URL(orion.url()).searchParams.get('sourceTab'))
    .toBe(String(secondTab));
  await expect(orion.getByRole('button', { name: 'Create notebook', exact: true })).toBeEnabled();
  await second.close();
  await chat.close();
  await expect(
    orion.getByText('Open ChatGPT or Claude in another tab, then tap Refresh.'),
  ).toBeVisible();
  await orion.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    orion.getByText('Open ChatGPT or Claude in another tab, then tap Refresh.'),
  ).toBeVisible();
  const reopened = await context.newPage();
  await reopened.goto('https://chatgpt.com/c/arc-reopened');
  await orion.bringToFront();
  // Refresh or the notebook's own polling reconnects once a chat tab says hello.
  await expect(orion.getByRole('button', { name: 'Create notebook', exact: true })).toBeEnabled();
  console.log(
    'PASS shared Chromium package: real side panel, silent and rejected API fallback, window reuse, saved UI preference across reload, original-source SPA capture, rejected window → notebook tab, Orion-style notebook tab (registry, picker, Refresh prompt)',
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
