import type { Message, SourceMessage } from '../../types';
import { isHidden } from '../chatgpt/detector';
import { projectMessageText } from '../chatgpt/projection';
import { richContent } from '../model/capture';

// claude.ai exposes no message IDs or role attributes beyond these containers.
// Keep every Claude-specific selector here so live markup changes stay local.
export const CLAUDE_USER_SELECTOR = '[data-testid="user-message"]';
export const CLAUDE_ASSISTANT_SELECTOR = '.font-claude-response, .font-claude-message';

export function claudeMessages(): SourceMessage[] {
  const found: SourceMessage[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(
    `${CLAUDE_USER_SELECTOR}, ${CLAUDE_ASSISTANT_SELECTOR}`,
  )) {
    if (isHidden(element) || found.some((old) => old.element.contains(element))) continue;
    const role = element.matches(CLAUDE_USER_SELECTOR) ? 'user' : 'assistant';
    // Positional IDs: stable while a branch is unchanged. Editing an earlier
    // turn creates a new branch, and anchors then fall back to quote matching.
    found.push({ element, role, id: `claude-${found.length}:${role}` });
  }
  return found;
}
export function claudeMessageText(element: HTMLElement): string {
  return projectMessageText(element, false).text;
}
export function extractClaudeMessages(): Message[] {
  return claudeMessages()
    .map(({ element, role, id }): Message => {
      const projection = projectMessageText(element, role === 'assistant');
      return {
        id,
        role,
        text: projection.text,
        ...(role === 'assistant' ? richContent(element, projection) : {}),
      };
    })
    .filter((message) => message.text || message.content?.blocks.length);
}
