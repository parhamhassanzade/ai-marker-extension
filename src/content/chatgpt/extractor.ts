import type { Message } from '../../types';
import { MESSAGE_SELECTOR, TURN_SELECTOR, isHidden, conversationRoot } from './detector';
import { projectMessageText } from './projection';
import { captureContent } from '../model/capture';
import { CONTENT_VERSION } from '../model/types';
type Role = Message['role'];
export interface MessageContainer {
  element: HTMLElement;
  role: Role;
  turn: HTMLElement;
}
export { UI_SELECTOR } from './detector';
function roleOf(element: HTMLElement): Role | undefined {
  for (const value of [
    element.dataset.messageAuthorRole,
    element.dataset.turn,
    element.dataset.role,
    element.getAttribute('data-author'),
  ]) {
    if (value === 'user' || value === 'assistant') return value;
  }
  const unitRole = (
    element.getAttribute('data-chatgpt-search-unit-key') ??
    element.getAttribute('data-content-search-unit-key')
  )?.match(/:(user|assistant)$/)?.[1];
  if (unitRole === 'user' || unitRole === 'assistant') return unitRole;
  const label =
    element.querySelector('h2,h3,h4,h5,h6,[data-testid="message-role"]')?.textContent?.trim() ?? '';
  if (/^(you said|user)(\s*:)?$/i.test(label)) return 'user';
  if (/^(chatgpt said|assistant)(\s*:)?$/i.test(label)) return 'assistant';
  return undefined;
}
export function messageContainers(): MessageContainer[] {
  const root = conversationRoot();
  const found: MessageContainer[] = [];
  // Prefer explicit author markers, with independent fallbacks for newer turn DOMs.
  for (const element of root.querySelectorAll<HTMLElement>(
    `${MESSAGE_SELECTOR}, ${TURN_SELECTOR}`,
  )) {
    if (isHidden(element)) continue;
    const turn =
      element.closest<HTMLElement>('[data-testid^="conversation-turn"],article') ?? element;
    const explicit = element.matches(MESSAGE_SELECTOR);
    if (!explicit && element.querySelector(MESSAGE_SELECTOR)) continue;
    const role = roleOf(element);
    if (!role || found.some((old) => old.element === element || old.element.contains(element)))
      continue;
    found.push({ element, role, turn });
  }
  return found;
}
export function messageId(
  element: HTMLElement,
  role: Role,
  turn: HTMLElement,
  index: number,
): string {
  return (
    element.getAttribute('data-chatgpt-search-message-ids')?.trim().split(/\s+/)[0] ||
    element
      .closest('[data-chatgpt-search-message-ids]')
      ?.getAttribute('data-chatgpt-search-message-ids')
      ?.trim()
      .split(/\s+/)[0] ||
    element.dataset.messageId ||
    turn.dataset.messageId ||
    element.closest('[data-message-id]')?.getAttribute('data-message-id') ||
    `${element.getAttribute('data-chatgpt-search-unit-key') || element.getAttribute('data-content-search-unit-key') || turn.getAttribute('data-testid') || turn.id || `position-${index}`}:${role}`
  );
}
// Serialize semantic block structure rather than depending on innerText or one
// markdown class. Work on the live DOM read-only; controls never enter the model.
export function cleanMessageText(root: HTMLElement): string {
  return projectMessageText(root, false).text;
}
export function contentOf(element: HTMLElement): HTMLElement {
  // Markdown/prose classes describe individual blocks, not necessarily the whole
  // answer. Keep the message boundary so differently styled later sections remain
  // selectable. cleanMessageText/sourceTextMap exclude controls and role labels.
  return element;
}
export function extractMessages(): Message[] {
  return messageContainers()
    .map(({ element, role, turn }, index) => {
      const timestamp =
        element.querySelector('time[datetime]')?.getAttribute('datetime') ??
        turn.querySelector('time[datetime]')?.getAttribute('datetime') ??
        undefined;
      const orderMatch = turn.getAttribute('data-testid')?.match(/^conversation-turn-(\d+)$/);
      const projection = projectMessageText(contentOf(element), role === 'assistant');
      const text = projection.text;
      return {
        id: messageId(element, role, turn, index),
        role,
        text,
        ...(role === 'assistant'
          ? {
              contentVersion: CONTENT_VERSION,
              content: captureContent(contentOf(element), projection),
            }
          : {}),
        ...(orderMatch ? { order: Number(orderMatch[1]) } : {}),
        ...(timestamp && Number.isFinite(Date.parse(timestamp)) ? { timestamp } : {}),
      };
    })
    .filter((message) => message.text || message.content?.blocks.length);
}
export function logExtraction(title: string, messages: Message[]): void {
  if (!import.meta.env.DEV) return;
  console.debug('[AI Notebook] extraction', { title, count: messages.length });
  console.table(
    messages.map((m, index) => ({ index, id: m.id, role: m.role, preview: m.text.slice(0, 100) })),
  );
}
