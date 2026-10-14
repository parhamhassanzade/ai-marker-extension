import type { Message } from '../types';
export interface Chapter {
  id: string;
  number: number;
  messages: Message[];
}
export function chaptersOf(messages: Message[]): Chapter[] {
  const chapters: Chapter[] = [];
  for (const message of messages) {
    let chapter = chapters.at(-1);
    // Consecutive questions stay together; an assistant-only opening is retained.
    if (
      !chapter ||
      (message.role === 'user' && chapter.messages.some((m) => m.role === 'assistant'))
    ) {
      chapter = { id: message.id, number: chapters.length + 1, messages: [] };
      chapters.push(chapter);
    }
    chapter.messages.push(message);
  }
  return chapters;
}

export function chapterTitle(chapter: Chapter): string {
  const text =
    chapter.messages.find((m) => m.role === 'user')?.text ??
    chapter.messages[0]?.text ??
    'Collected ideas';
  const title = text
    .replace(/[#*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title.length > 90 ? title.slice(0, 87) + '…' : title;
}
