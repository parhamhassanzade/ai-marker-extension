import { safeLink } from './types';
import type { MessageContent } from './types';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const integer = (value: unknown): value is number => Number.isSafeInteger(value);

// The same guard is used at the worker boundary and by the backup codec. Unknown
// node types/versions and raw-HTML fields are rejected, not silently trusted.
export function isMessageContent(value: unknown, canonical: string): value is MessageContent {
  let count = 0;
  let mappings = 0;
  let strings = 0;
  const ranges: { start: number; end: number }[] = [];
  function string(value: unknown, limit = 2_000_000): value is string {
    if (typeof value !== 'string' || value.length > limit) return false;
    strings += value.length;
    return strings <= 4_000_000;
  }
  function array(value: unknown, check: (item: unknown) => boolean): boolean {
    return Array.isArray(value) && value.length <= 20_000 && value.every(check);
  }
  function range(
    value: unknown,
  ): value is Record<string, unknown> & { start: number; end: number } {
    return (
      record(value) &&
      integer(value.start) &&
      integer(value.end) &&
      value.start >= 0 &&
      value.end > value.start &&
      value.end <= canonical.length
    );
  }
  function text(value: unknown): boolean {
    if (
      !record(value) ||
      ++count > 20_000 ||
      value.type !== 'text' ||
      !keys(value, ['type', 'text', 'marks', 'mappings']) ||
      !string(value.text) ||
      !record(value.marks) ||
      !keys(value.marks, ['bold', 'italic', 'strike', 'code', 'href'])
    )
      return false;
    const marks = value.marks;
    for (const key of ['bold', 'italic', 'strike', 'code'])
      if (key in marks && marks[key] !== true) return false;
    if (
      'href' in marks &&
      (typeof marks.href !== 'string' ||
        marks.href.length > 3000 ||
        safeLink(marks.href) !== marks.href)
    )
      return false;
    let offset = 0;
    const runText = value.text;
    const valid = array(value.mappings, (map) => {
      if (
        ++mappings > 40_000 ||
        !range(map) ||
        !record(map) ||
        !keys(map, ['start', 'end', 'textStart', 'textEnd']) ||
        !integer(map.textStart) ||
        !integer(map.textEnd) ||
        map.textStart !== offset ||
        map.textEnd > runText.length ||
        map.textEnd - map.textStart !== map.end - map.start ||
        runText.slice(map.textStart, map.textEnd) !== canonical.slice(map.start, map.end)
      )
        return false;
      ranges.push({ start: map.start, end: map.end });
      offset = map.textEnd;
      return true;
    });
    return valid && offset === runText.length;
  }
  function inline(value: unknown): boolean {
    if (!record(value)) return false;
    if (value.type === 'text') return text(value);
    if (++count > 20_000) return false;
    if (value.type === 'break') return keys(value, ['type']);
    if (value.type === 'math')
      return (
        keys(value, ['type', 'latex', 'display', 'children']) &&
        string(value.latex, 100_000) &&
        typeof value.display === 'boolean' &&
        array(value.children, text)
      );
    return (
      value.type === 'unsupported' &&
      keys(value, ['type', 'label', 'children']) &&
      typeof value.label === 'string' &&
      [
        '[image not captured]',
        '[canvas not captured]',
        '[attachment not captured]',
        '[interactive content not captured]',
      ].includes(value.label) &&
      array(value.children, text)
    );
  }
  function block(value: unknown, depth: number): boolean {
    if (!record(value) || ++count > 20_000 || depth > 32) return false;
    const blocks = (items: unknown) => array(items, (item) => block(item, depth + 1));
    switch (value.type) {
      case 'paragraph':
        return keys(value, ['type', 'children']) && array(value.children, inline);
      case 'heading':
        return (
          keys(value, ['type', 'level', 'children']) &&
          integer(value.level) &&
          value.level >= 1 &&
          value.level <= 6 &&
          array(value.children, inline)
        );
      case 'code':
        return (
          keys(value, ['type', 'language', 'children']) &&
          typeof value.language === 'string' &&
          /^(?:[\w#+.-]{1,40})?$/.test(value.language) &&
          array(value.children, text)
        );
      case 'blockquote':
        return keys(value, ['type', 'children']) && blocks(value.children);
      case 'rule':
        return keys(value, ['type']);
      case 'list':
        return (
          keys(value, ['type', 'ordered', 'start', 'items']) &&
          typeof value.ordered === 'boolean' &&
          integer(value.start) &&
          array(value.items, blocks)
        );
      case 'table': {
        if (
          !keys(value, ['type', 'headerRows', 'alignments', 'rows']) ||
          !integer(value.headerRows) ||
          value.headerRows < 0 ||
          !Array.isArray(value.rows) ||
          value.headerRows > value.rows.length
        )
          return false;
        return (
          array(
            value.alignments,
            (align) =>
              align === null ||
              (typeof align === 'string' && ['left', 'center', 'right'].includes(align)),
          ) &&
          array(
            value.rows,
            (row) => record(row) && keys(row, ['cells']) && array(row.cells, blocks),
          )
        );
      }
      default:
        return false;
    }
  }
  if (
    !record(value) ||
    !keys(value, ['blocks', 'gaps']) ||
    !array(value.blocks, (item) => block(item, 0)) ||
    !array(value.gaps, (gap) => {
      if (!range(gap) || !record(gap) || !keys(gap, ['start', 'end'])) return false;
      ranges.push({ start: gap.start, end: gap.end });
      return true;
    })
  )
    return false;
  // Every canonical code unit has exactly one owner, including synthetic text.
  ranges.sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const part of ranges) {
    if (part.start !== cursor) return false;
    cursor = part.end;
  }
  return cursor === canonical.length;
}
