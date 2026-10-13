import type { AIPlatformAdapter, Message } from '../types';
// Contract for a future adapter. Intentionally disabled until extraction is verified.
export class ClaudeAdapter implements AIPlatformAdapter {
  readonly platform = 'Claude' as const;
  detectConversation() {
    return false;
  }
  extractMessages(): Message[] {
    throw new Error('Claude capture is not available yet.');
  }
  extractTitle(): string {
    throw new Error('Claude capture is not available yet.');
  }
  getConversationId(): string {
    throw new Error('Claude capture is not available yet.');
  }
}
