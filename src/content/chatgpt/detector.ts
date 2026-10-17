export const UI_SELECTOR =
  'button, [role="button"], input, textarea, select, svg, script, style, time, nav, aside, [hidden], [aria-hidden="true"], [data-testid*="message-actions"], [data-testid*="feedback"], .sr-only, .visually-hidden';
export const MESSAGE_SELECTOR =
  '[data-message-author-role="user"], [data-message-author-role="assistant"]';
export const TURN_SELECTOR =
  'article[data-testid^="conversation-turn"], [data-testid^="conversation-turn-"], [data-turn="user"], [data-turn="assistant"], [data-role="user"], [data-role="assistant"], [data-author="user"], [data-author="assistant"], [data-chatgpt-search-unit-key], [data-content-search-unit-key], article';
export const isChatGPT = () => ['chatgpt.com', 'chat.openai.com'].includes(location.hostname);
export function isHidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches('[hidden], [aria-hidden="true"], nav, aside, [role="navigation"]'))
      return true;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

export function conversationRoot(): HTMLElement {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('main, [role="main"]')).filter(
    (root) => !isHidden(root),
  );
  return (
    roots.find((root) => root.querySelector(`${MESSAGE_SELECTOR}, ${TURN_SELECTOR}`)) ??
    roots[0] ??
    document.body
  );
}
