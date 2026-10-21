import type { ConversationSnapshot } from '../types';
import { conversationIdOf, platformOf } from '../platforms';
export function matchesHighlightSource(
  snapshot: ConversationSnapshot,
  sender: Pick<chrome.runtime.MessageSender, 'url' | 'frameId'>,
  currentTabUrl?: string,
): boolean {
  try {
    const documentUrl = new URL(sender.url ?? '');
    const current = new URL(currentTabUrl ?? '');
    const target = new URL(snapshot.website);
    // sender.url can describe the document's original route after pushState.
    // Trust it for the origin, and read the tab's live URL for conversation scope.
    if (
      (sender.frameId ?? 0) !== 0 ||
      platformOf(documentUrl.href) !== snapshot.platform ||
      platformOf(current.href) !== snapshot.platform ||
      platformOf(target.href) !== snapshot.platform ||
      documentUrl.origin !== target.origin ||
      current.origin !== target.origin ||
      current.pathname !== target.pathname
    )
      return false;
    const id = conversationIdOf(snapshot.platform, target.pathname);
    return id ? id === snapshot.conversationId : snapshot.conversationId.startsWith('temporary:');
  } catch {
    return false;
  }
}
