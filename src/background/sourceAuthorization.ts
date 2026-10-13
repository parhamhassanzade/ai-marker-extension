import type { ConversationSnapshot } from '../types';
const supported = (url: URL) =>
  url.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(url.hostname);
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
      snapshot.platform !== 'ChatGPT' ||
      !supported(documentUrl) ||
      !supported(current) ||
      !supported(target) ||
      documentUrl.origin !== target.origin ||
      current.origin !== target.origin ||
      current.pathname !== target.pathname
    )
      return false;
    const id = target.pathname.match(/\/c\/([^/]+)/)?.[1];
    return id ? id === snapshot.conversationId : snapshot.conversationId.startsWith('temporary:');
  } catch {
    return false;
  }
}
