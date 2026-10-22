// JSON-only schema. Offsets are UTF-16 code units, as in the existing anchors.
export const CONTENT_VERSION = 1 as const;
export interface TextMapping {
  start: number;
  end: number;
  textStart: number;
  textEnd: number;
}
export interface TextMarks {
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
  href?: string;
}
export interface ContentText {
  type: 'text';
  text: string;
  marks: TextMarks;
  mappings: TextMapping[];
}
export type ContentInline =
  | ContentText
  | { type: 'break' }
  | { type: 'math'; latex: string; display: boolean; children: ContentText[] }
  | { type: 'unsupported'; label: string; children: ContentText[] }
  // An image adds no canonical characters. Its bytes live in the image store,
  // keyed by notebook, message, and this index.
  | { type: 'image'; index: number; alt: string };
export type ContentBlock =
  | { type: 'paragraph'; children: ContentInline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: ContentInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ContentBlock[][] }
  | {
      type: 'table';
      headerRows: number;
      alignments: ('left' | 'center' | 'right' | null)[];
      rows: { cells: ContentBlock[][] }[];
    }
  | { type: 'code'; language: string; children: ContentText[] }
  | { type: 'blockquote'; children: ContentBlock[] }
  | { type: 'rule' };
export interface MessageContent {
  blocks: ContentBlock[];
  // Canonical characters supplied by structure rather than a DOM text leaf:
  // newlines, list markers, cell separators, or legacy-only visible wrappers.
  gaps: { start: number; end: number }[];
}

export function safeLink(value: string): string | undefined {
  if (value.length > 3000) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) && url.href.length <= 3000
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function contentTextRuns(content: MessageContent): ContentText[] {
  const runs: ContentText[] = [];
  const inline = (items: ContentInline[]) => {
    for (const item of items)
      if (item.type === 'text') runs.push(item);
      else if (item.type !== 'break' && item.type !== 'image') runs.push(...item.children);
  };
  const blocks = (items: ContentBlock[]) => {
    for (const item of items) {
      if (item.type === 'paragraph' || item.type === 'heading') inline(item.children);
      if (item.type === 'code') runs.push(...item.children);
      if (item.type === 'blockquote') blocks(item.children);
      if (item.type === 'list') item.items.forEach(blocks);
      if (item.type === 'table') item.rows.forEach((row) => row.cells.forEach(blocks));
    }
  };
  blocks(content.blocks);
  return runs;
}

// Inverse mappings deliberately return undefined for generated UI/placeholder
// text. A renderer must not count a copy button or LaTeX fallback as source text.
export function canonicalOffset(
  run: ContentText,
  offset: number,
  affinity: 'start' | 'end' = 'start',
): number | undefined {
  for (const map of run.mappings)
    if (
      affinity === 'start'
        ? offset >= map.textStart && (offset < map.textEnd || offset === run.text.length)
        : offset <= map.textEnd && (offset > map.textStart || offset === 0)
    )
      return map.start + offset - map.textStart;
  return undefined;
}
export function runOffset(run: ContentText, offset: number): number | undefined {
  for (const map of run.mappings)
    if (offset >= map.start && offset <= map.end) return map.textStart + offset - map.start;
  return undefined;
}
