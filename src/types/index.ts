export type Platform = 'ChatGPT' | 'Claude' | 'Gemini' | 'Perplexity';
export type HighlightColor = 'yellow' | 'green' | 'red';
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  order?: number;
}
export interface ConversationSnapshot {
  platform: Platform;
  conversationId: string;
  title: string;
  website: string;
  messages: Message[];
}
export interface TextAnchor {
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}
export interface Highlight {
  id: string;
  platform: Platform;
  conversationId: string;
  messageId: string;
  text: string;
  color: HighlightColor;
  note: string;
  createdAt: string;
  website: string;
  anchor: TextAnchor;
}
export interface Notebook {
  id: string;
  title: string;
  conversationTitle: string;
  platform: Platform;
  conversationId: string;
  website: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  messages: Message[];
  highlights: Highlight[];
}
export interface Database {
  version: 1;
  notebooks: Notebook[];
  activeByConversation: Record<string, string>;
  pausedConversations: string[];
}
export interface AIPlatformAdapter {
  platform: Platform;
  detectConversation(): boolean;
  extractMessages(): Message[];
  extractTitle(): string;
  getConversationId(): string;
}
export type Command =
  | { type: 'sourceHighlight'; snapshot: ConversationSnapshot; highlight: Highlight }
  | { type: 'activate'; snapshot: ConversationSnapshot }
  | { type: 'pause'; id: string }
  | { type: 'annotate'; id: string; highlight: Highlight }
  | { type: 'updateNote'; id: string; highlightId: string; note: string }
  | { type: 'sync'; snapshot: ConversationSnapshot; previousConversationId?: string }
  | { type: 'list' }
  | { type: 'create'; snapshot: ConversationSnapshot; title?: string }
  | { type: 'finish'; id: string }
  | { type: 'clear'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'removeHighlight'; id: string; highlightId: string };
export type Result = { ok: true; data: Database } | { ok: false; error: string };
