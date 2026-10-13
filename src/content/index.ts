import { startSourceHighlighter } from './sourceHighlighter';
import { storage } from '../storage/storage';
import { detectAdapter, snapshotOf } from '../adapters';
import { captureHistory } from './chatgpt/history';
import type { AIPlatformAdapter } from '../types';
import { ChatGPTAdapter } from '../adapters/ChatGPTAdapter';
function startCapture(adapter: AIPlatformAdapter): () => void {
  const stopSourceHighlighter = startSourceHighlighter(adapter);
  let currentPath = location.pathname;
  let currentId = adapter.getConversationId();
  let lastSignature = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;
  let previousConversationId: string | undefined;
  let enabled = false;
  let historyCancelled = false;
  let historyRunning = false;
  let disposed = false;
  let lastCaptureError: string | undefined;
  function schedule(delay = 500) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void capture();
    }, delay);
  }
  async function capture(force = false) {
    if (disposed) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      if (currentPath !== location.pathname) {
        previousConversationId = currentId;
        const wasTemporary = currentId.startsWith('temporary:');
        currentPath = location.pathname;
        if (!location.pathname.match(/\/c\/[^/]+/) && adapter instanceof ChatGPTAdapter)
          adapter.resetTemporaryId();
        currentId = adapter.getConversationId();
        lastSignature = '';
        // Let the SPA replace its old message DOM before capturing a different chat.
        if (!wasTemporary) {
          schedule(500);
          return;
        }
      }
      if (!enabled && !force && !previousConversationId) return;
      const snapshot = snapshotOf(adapter);
      const signature = JSON.stringify(snapshot);
      if (force || signature !== lastSignature) {
        const db = await storage.syncConversation(snapshot, previousConversationId);
        enabled = !!db.activeByConversation[`${snapshot.platform}:${snapshot.conversationId}`];
        lastSignature = signature;
        previousConversationId = undefined;
        lastCaptureError = undefined;
      }
    } catch (error) {
      lastCaptureError = error instanceof Error ? error.message : 'Could not update the notebook.';
      console.warn('[AI Notebook]', error);
      void chrome.runtime
        .sendMessage({ type: 'captureError', error: lastCaptureError })
        .catch(() => undefined);
    } finally {
      running = false;
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  }
  // Observing documentElement also captures title changes, without touching page JS.
  const observer = new MutationObserver(() => {
    if (enabled) schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const urlTimer = setInterval(() => {
    if (currentPath !== location.pathname) schedule(100);
  }, 800);
  const unsubscribe = storage.subscribe(() => {
    void capture(true);
  });
  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: unknown) => void,
  ) => {
    if (
      sender.id !== chrome.runtime.id ||
      typeof message !== 'object' ||
      !message ||
      !('type' in message)
    )
      return false;
    if (message.type === 'ping') {
      respond({ version: chrome.runtime.getManifest().version });
      return false;
    }
    if (message.type === 'cancelHistory') {
      historyCancelled = true;
      respond({ ok: true });
      return false;
    }
    if (message.type === 'captureHistory') {
      if (historyRunning) {
        respond({ ok: false, error: 'Conversation capture is already running.' });
        return false;
      }
      historyCancelled = false;
      historyRunning = true;
      void captureHistory(adapter, () => historyCancelled || disposed)
        .then((result) => respond({ ok: true, ...result }))
        .catch((error) =>
          respond({
            ok: false,
            error: error instanceof Error ? error.message : 'Could not capture older messages.',
          }),
        )
        .finally(() => {
          historyRunning = false;
        });
      return true;
    }
    if (message.type === 'context') {
      respond(snapshotOf(adapter));
      return false;
    }
    if (message.type === 'refreshConversation') {
      void (async () => {
        while (running) await new Promise((resolve) => setTimeout(resolve, 20));
        await capture(true);
        respond({ ok: !lastCaptureError, error: lastCaptureError });
      })();
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  // Discover persisted activation on reload. sync will never create a notebook.
  void capture(true);
  return () => {
    disposed = true;
    stopSourceHighlighter();
    historyCancelled = true;
    clearTimeout(timer);
    clearInterval(urlTimer);
    observer.disconnect();
    try {
      unsubscribe();
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      /* An extension reload invalidates the old runtime context. */
    }
  };
}
const state = globalThis as typeof globalThis & {
  __aiNotebookCapture?: { owner: string; alive(): boolean; dispose(): void };
};
const owner = `${chrome.runtime.id}:${chrome.runtime.getManifest().version}`;
const previous = state.__aiNotebookCapture;
if (!previous || previous.owner !== owner || !previous.alive()) {
  previous?.dispose();
  const adapter = detectAdapter();
  if (adapter)
    state.__aiNotebookCapture = {
      owner,
      alive: () => !!chrome.runtime.id,
      dispose: startCapture(adapter),
    };
}
