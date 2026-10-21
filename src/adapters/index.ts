import type { AIPlatformAdapter, ConversationSnapshot } from '../types';
import { ChatGPTAdapter } from './ChatGPTAdapter';
import { ClaudeAdapter } from './ClaudeAdapter';
export const adapters: AIPlatformAdapter[] = [new ChatGPTAdapter(), new ClaudeAdapter()];
export const detectAdapter = () => adapters.find((adapter) => adapter.detectConversation());
export const snapshotOf = (adapter: AIPlatformAdapter): ConversationSnapshot => ({
  platform: adapter.platform,
  conversationId: adapter.getConversationId(),
  title: adapter.extractTitle(),
  website: `${location.origin}${location.pathname}`,
  messages: adapter.extractMessages(),
});
