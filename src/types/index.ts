import type { MessageContent } from '../content/model/types';
export type Platform = 'ChatGPT' | 'Claude' | 'Gemini' | 'Perplexity';
export type HighlightColor = 'yellow' | 'green' | 'red';
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  order?: number;
  contentVersion?: 1;
  content?: MessageContent;
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
  tags?: string[];
  bookmarked?: boolean;
}
export interface NotebookOverview {
  summary: string;
  topics: string[];
  keyInsights: { text: string; messageId: string }[];
  kind: 'local' | 'manual';
  generatedAt: string;
  sourceSignature: string;
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
  overview?: NotebookOverview;
}
export interface Database {
  version: 1;
  notebooks: Notebook[];
  activeByConversation: Record<string, string>;
  pausedConversations: string[];
}
/** A message's live DOM root, with the same ID that extractMessages() reports. */
export interface SourceMessage {
  element: HTMLElement;
  role: Message['role'];
  id: string;
}
export interface AIPlatformAdapter {
  platform: Platform;
  detectConversation(): boolean;
  extractMessages(): Message[];
  extractTitle(): string;
  getConversationId(): string;
  /** Ordered message roots used for on-page highlights and history scrolling. */
  sourceMessages(): SourceMessage[];
  /** Canonical message text; must equal the extracted message.text. */
  sourceText(element: HTMLElement): string;
  /** A new, unsaved chat starts a fresh temporary conversation ID. */
  resetTemporaryId?(): void;
}
export type Command =
  | {
      type: 'updateAnnotation';
      id: string;
      highlightId: string;
      note: string;
      tags: string[];
      bookmarked: boolean;
    }
  | {
      type: 'saveOverview';
      id: string;
      summary: string;
      kind: 'manual';
      sourceSignature: string;
    }
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
