import type { AIPlatformAdapter } from '../../types';
import { snapshotOf } from '../../adapters';
import { storage } from '../../storage/storage';
import { messageContainers } from './extractor';
function scrollContainer(): HTMLElement {
  let node = messageContainers()[0]?.element.parentElement;
  while (node) {
    if (
      node.scrollHeight > node.clientHeight + 20 &&
      /auto|scroll/.test(getComputedStyle(node).overflowY)
    )
      return node;
    node = node.parentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}
export async function captureHistory(
  adapter: AIPlatformAdapter,
  cancelled: () => boolean,
): Promise<{ complete: boolean }> {
  const root = scrollContainer();
  const originalTop = root.scrollTop;
  const originalBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  const id = adapter.getConversationId();
  let stableTop = 0;
  let previousFirst = '';
  try {
    // Walk backwards with overlapping viewports. This gives virtualized messages a
    // chance to mount, without accessing private APIs or submitting chat input.
    for (let step = 0; step < 60; step++) {
      if (cancelled() || adapter.getConversationId() !== id) return { complete: false };
      const snapshot = snapshotOf(adapter);
      await storage.syncConversation(snapshot);
      const first = snapshot.messages[0]?.id ?? '';
      if (root.scrollTop <= 1 && first === previousFirst) stableTop++;
      else stableTop = 0;
      if (stableTop >= 3) return { complete: true };
      previousFirst = first;
      root.scrollTop = Math.max(0, root.scrollTop - Math.max(200, root.clientHeight * 0.75));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { complete: false };
  } finally {
    root.style.scrollBehavior = originalBehavior;
    if (adapter.getConversationId() === id) root.scrollTop = originalTop;
  }
}
