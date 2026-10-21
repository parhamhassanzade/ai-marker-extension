import type { AIPlatformAdapter } from '../types';
import { conversationIdOf } from '../platforms';
import { isChatGPT } from '../content/chatgpt/detector';
import {
  cleanMessageText,
  contentOf,
  extractMessages,
  logExtraction,
  messageContainers,
  messageId,
} from '../content/chatgpt/extractor';
export class ChatGPTAdapter implements AIPlatformAdapter {
  readonly platform = 'ChatGPT' as const;
  private temporaryId = `temporary:${crypto.randomUUID()}`;
  detectConversation() {
    return isChatGPT();
  }
  getConversationId() {
    return conversationIdOf('ChatGPT', location.pathname) ?? this.temporaryId;
  }
  resetTemporaryId() {
    this.temporaryId = `temporary:${crypto.randomUUID()}`;
  }
  sourceMessages() {
    return messageContainers().map(({ element, role, turn }, index) => ({
      element: contentOf(element),
      role,
      id: messageId(element, role, turn, index),
    }));
  }
  sourceText(element: HTMLElement) {
    return cleanMessageText(element);
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
