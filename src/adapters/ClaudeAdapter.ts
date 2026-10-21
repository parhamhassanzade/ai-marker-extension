import type { AIPlatformAdapter } from '../types';
import { conversationIdOf, platformOf } from '../platforms';
import {
  claudeMessages,
  claudeMessageText,
  extractClaudeMessages,
} from '../content/claude/extractor';
export class ClaudeAdapter implements AIPlatformAdapter {
  readonly platform = 'Claude' as const;
  private temporaryId = `temporary:${crypto.randomUUID()}`;
  detectConversation() {
    return platformOf(location.href) === 'Claude';
  }
  getConversationId() {
    return conversationIdOf('Claude', location.pathname) ?? this.temporaryId;
  }
  resetTemporaryId() {
    this.temporaryId = `temporary:${crypto.randomUUID()}`;
  }
  sourceMessages() {
    return claudeMessages();
  }
  sourceText(element: HTMLElement) {
    return claudeMessageText(element);
  }
  extractMessages() {
    return extractClaudeMessages();
  }
  extractTitle() {
    const title = document.title.replace(/\s*[-–|]\s*Claude\s*$/i, '').trim();
    return title && title !== 'Claude'
      ? title
      : this.extractMessages()
          .find((m) => m.role === 'user')
          ?.text.slice(0, 100) || 'Untitled conversation';
  }
}
