import { chromium, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(tmpdir(), 'ai-notebook-arc-'));
const extension = path.resolve('build/arc');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const fixture = await readFile('tests/fixtures/chatgpt-semantic.html', 'utf8');
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' }),
  );
  const chat = await context.newPage();
  await chat.goto('https://chatgpt.com/c/arc-chat');
  const browserSession = await context.browser().newBrowserCDPSession();
  await worker.evaluate(() => chrome.action.openPopup());
  let popupTarget;
  await expect
    .poll(async () => {
      popupTarget = (await browserSession.send('Target.getTargets')).targetInfos.find((target) =>
        target.url.endsWith('/sidepanel.html'),
      );
      return !!popupTarget;
    })
    .toBe(true);
  const { sessionId } = await browserSession.send('Target.attachToTarget', {
    targetId: popupTarget.targetId,
    flatten: false,
  });
  let messageId = 0;
  async function popupEvaluate(expression) {
    const id = ++messageId;
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        browserSession.off('Target.receivedMessageFromTarget', listener);
        reject(new Error('Popup evaluation timed out'));
      }, 5000);
      const listener = (event) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== id) return;
        clearTimeout(timeout);
        browserSession.off('Target.receivedMessageFromTarget', listener);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result.result.value);
      };
      browserSession.on('Target.receivedMessageFromTarget', listener);
    });
    await browserSession.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    });
    return result;
  }
  await expect
    .poll(() =>
      popupEvaluate(
        `Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Create notebook' && !button.disabled)`,
      ),
    )
    .toBe(true);
  const popupOpened = context.waitForEvent('page');
  await popupEvaluate(
    `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Keep notebook open')).click(); true`,
  );
  const panel = await popupOpened;
  const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await expect(panel.getByRole('button', { name: 'Create notebook', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await panel.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(panel.locator('[data-notebook-message-id]')).toHaveCount(4);
  await panel.getByText('About AI Notebook', { exact: true }).click();
  const supportLink = panel.locator('.about-support').getByRole('link', {
    name: 'Support AI Notebook on Ko-fi (opens in a new tab)',
  });
  await expect(supportLink).toHaveAttribute('href', 'https://ko-fi.com/parham3752');
  await expect(supportLink).toHaveAttribute('target', '_blank');
  await expect(supportLink).toHaveAttribute('rel', 'noopener noreferrer');
  expect(await worker.evaluate(async (id) => (await chrome.windows.get(id)).type, windowId)).toBe(
    'popup',
  );
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
  console.log(
    'PASS Arc distribution on Chromium: native toolbar popup opens, Keep notebook open creates a connected window, notebook connects to original window, captures old/project conversations after SPA navigation',
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
