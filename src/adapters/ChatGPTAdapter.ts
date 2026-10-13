import type { AIPlatformAdapter } from '../types';
import { isChatGPT } from '../content/chatgpt/detector';
import { extractMessages, logExtraction } from '../content/chatgpt/extractor';
export class ChatGPTAdapter implements AIPlatformAdapter {
  readonly platform = 'ChatGPT' as const;
  private temporaryId = `temporary:${crypto.randomUUID()}`;
  detectConversation() {
    return isChatGPT();
  }
  getConversationId() {
    return location.pathname.match(/\/c\/([^/]+)/)?.[1] ?? this.temporaryId;
  }
  resetTemporaryId() {
    this.temporaryId = `temporary:${crypto.randomUUID()}`;
  }
  extractMessages() {
    const messages = extractMessages();
    logExtraction(document.title, messages);
    return messages;
  }
  extractTitle() {
    const title = document.title.replace(/\s*[-–|]\s*ChatGPT\s*$/i, '').trim();
    return title && title !== 'ChatGPT'
      ? title
      : this.extractMessages()
          .find((m) => m.role === 'user')
          ?.text.slice(0, 100) || 'Untitled conversation';
  }
}
