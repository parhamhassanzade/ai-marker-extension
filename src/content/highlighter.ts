import type { Highlight, TextAnchor } from '../types';
export const COLORS = { yellow: '#f9df80', green: '#a7e4bf', red: '#f6a8a5' };
export function anchorSelection(
  root: HTMLElement,
  range: Range,
): { text: string; anchor: TextAnchor } {
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const text = range.toString();
  const all = root.textContent ?? '';
  return {
    text,
    anchor: {
      start,
      end: start + text.length,
      prefix: all.slice(Math.max(0, start - 40), start),
      suffix: all.slice(start + text.length, start + text.length + 40),
    },
  };
}
export function resolveAnchor(
  text: string,
  highlight: Pick<Highlight, 'text' | 'anchor'>,
): number | undefined {
  const { anchor, text: quote } = highlight;
  if (!quote) return undefined;
  const matches: number[] = [];
  let index = text.indexOf(quote);
  while (index !== -1) {
    matches.push(index);
    index = text.indexOf(quote, index + 1);
  }
  const contextMatches = matches.filter(
    (i) =>
      (!anchor.prefix || text.slice(Math.max(0, i - anchor.prefix.length), i) === anchor.prefix) &&
      (!anchor.suffix ||
        text.slice(i + quote.length, i + quote.length + anchor.suffix.length) === anchor.suffix),
  );
  if (contextMatches.includes(anchor.start)) return anchor.start;
  if (contextMatches.length === 1) return contextMatches[0];
  if (matches.length === 1) return matches[0];
  // Ambiguous repeats are left unpainted rather than attaching to the wrong passage.
  return undefined;
}
export function removeMarks(root: HTMLElement) {
  const parents = new Set<Node>();
  root.querySelectorAll<HTMLElement>('mark[data-ai-marker]').forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      parents.add(parent);
      mark.replaceWith(...mark.childNodes);
    }
  });
  parents.forEach((parent) => parent.normalize());
}
export function paintHighlight(root: HTMLElement, highlight: Highlight) {
  const start = resolveAnchor(root.textContent ?? '', highlight);
  if (start === undefined) return;
  const end = start + highlight.text.length;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const portions: { node: Text; start: number; end: number }[] = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.length;
    if (offset < end && offset + length > start)
      portions.push({
        node,
        start: Math.max(0, start - offset),
        end: Math.min(length, end - offset),
      });
    offset += length;
  }
  // Wrap each text fragment separately, preserving links, code, and paragraph elements.
  portions.reverse().forEach((part) => {
    const range = document.createRange();
    range.setStart(part.node, part.start);
    range.setEnd(part.node, part.end);
    const mark = document.createElement('mark');
    mark.dataset.aiMarker = highlight.id;
    mark.title = highlight.note || 'AI Notebook';
    mark.style.cssText = `background:${COLORS[highlight.color]};color:#20251f;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone;`;
    range.surroundContents(mark);
  });
}

export interface HighlightSegment {
  start: number;
  end: number;
  text: string;
  highlights: Highlight[];
}
// One overlap/anchor policy shared by the reader and the PDF renderer.
export function highlightSegments(text: string, highlights: Highlight[]): HighlightSegment[] {
  const ranges = highlights.flatMap((highlight) => {
    const start = resolveAnchor(text, highlight);
    return start === undefined ? [] : [{ start, end: start + highlight.text.length, highlight }];
  });
  const boundaries = [
    ...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])]),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1]!;
    return {
      start,
      end,
      text: text.slice(start, end),
      highlights: ranges.filter((r) => r.start <= start && r.end >= end).map((r) => r.highlight),
    };
  });
}
