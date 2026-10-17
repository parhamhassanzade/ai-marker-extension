import { UI_SELECTOR, isHidden } from '../chatgpt/detector';
import type { MessageProjection } from '../chatgpt/projection';
import {
  contentTextRuns,
  safeLink,
  type ContentBlock,
  type ContentInline,
  type ContentText,
  type MessageContent,
  type TextMarks,
} from './types';

const mathSelector = 'math, .katex, .katex-display, mjx-container, [data-latex], [data-math]';
const unsupportedSelector =
  'img, picture, canvas, iframe, object, embed, video, audio, svg, [data-testid*="attachment"], [data-testid*="widget"], a[download]';

export function captureContent(root: HTMLElement, projection: MessageProjection): MessageContent {
  const spans = new Map<Node, typeof projection.spans>();
  for (const span of projection.spans) {
    const existing = spans.get(span.node) ?? [];
    existing.push(span);
    spans.set(span.node, existing);
  }
  let nodes = 0;
  function guard(depth: number) {
    if (depth > 32 || ++nodes > 20_000)
      throw new Error('Message formatting exceeds safe nesting or node limits.');
  }
  function text(node: Node, marks: TextMarks): ContentText[] {
    const parts = spans.get(node) ?? [];
    if (!parts.length) return [];
    // Include normalized newlines between fragments of the same DOM text node.
    const start = parts[0]!.start;
    const end = parts.at(-1)!.end;
    const value = projection.text.slice(start, end);
    return [
      {
        type: 'text',
        text: value,
        marks: { ...marks },
        mappings: [{ start, end, textStart: 0, textEnd: value.length }],
      },
    ];
  }
  function rawRuns(node: Node, marks: TextMarks = {}, depth = 0): ContentText[] {
    guard(depth);
    if (node.nodeType === Node.TEXT_NODE) return text(node, marks);
    return Array.from(node.childNodes).flatMap((child) => rawRuns(child, marks, depth + 1));
  }
  function special(element: Element): ContentInline | undefined {
    if (element.matches(mathSelector)) {
      const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
      const latex =
        element.getAttribute('data-latex') ??
        element.getAttribute('data-math') ??
        annotation?.textContent ??
        '';
      if (latex.length > 100_000)
        throw new Error('Math source exceeds the 100,000 character capture limit.');
      return {
        type: 'math',
        latex,
        display:
          element.matches('.katex-display') ||
          element.getAttribute('display') === 'true' ||
          element.getAttribute('display') === 'block',
        children: rawRuns(element),
      };
    }
    if (element.matches(unsupportedSelector)) {
      const kind = element.matches('img,picture')
        ? 'image'
        : element.matches('canvas')
          ? 'canvas'
          : element.matches('[data-testid*="attachment"],a[download]')
            ? 'attachment'
            : 'interactive content';
      return { type: 'unsupported', label: `[${kind} not captured]`, children: rawRuns(element) };
    }
    return undefined;
  }
  function excluded(element: Element): boolean {
    return (
      element.matches(UI_SELECTOR) ||
      isHidden(element) ||
      (/^H[1-6]$/.test(element.tagName) &&
        /^(you said|chatgpt said|user|assistant)\s*:?$/i.test(element.textContent?.trim() ?? ''))
    );
  }
  function inline(node: Node, marks: TextMarks = {}, depth = 0): ContentInline[] {
    guard(depth);
    if (node.nodeType === Node.TEXT_NODE) return text(node, marks);
    if (!(node instanceof Element) || isHidden(node)) return [];
    const captured = special(node);
    if (captured) return [captured];
    if (excluded(node)) return [];
    if (node.tagName === 'BR') return [{ type: 'break' }];
    const next = { ...marks };
    const tag = node.tagName;
    if (tag === 'B' || tag === 'STRONG') next.bold = true;
    if (tag === 'I' || tag === 'EM') next.italic = true;
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') next.strike = true;
    if (tag === 'CODE') next.code = true;
    if (tag === 'A') {
      const href = safeLink(node.getAttribute('href') ?? '');
      if (href) next.href = href;
    }
    return Array.from(node.childNodes).flatMap((child) => inline(child, next, depth + 1));
  }
  function blocks(parent: Element, depth = 0): ContentBlock[] {
    guard(depth);
    const result: ContentBlock[] = [];
    let pending: ContentInline[] = [];
    function flush() {
      if (pending.length) result.push({ type: 'paragraph', children: pending });
      pending = [];
    }
    for (const child of parent.childNodes) {
      if (!(child instanceof Element)) {
        pending.push(...inline(child));
        continue;
      }
      if (isHidden(child)) continue;
      const captured = special(child);
      if (captured) {
        pending.push(captured);
        continue;
      }
      if (excluded(child)) continue;
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) {
        flush();
        result.push({
          type: 'heading',
          level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
          children: inline(child),
        });
      } else if (tag === 'P') {
        flush();
        result.push({ type: 'paragraph', children: inline(child) });
      } else if (tag === 'PRE') {
        flush();
        const code = child.querySelector('code');
        const language =
          code?.className.match(/(?:^|\s)language-([\w#+.-]{1,40})(?:\s|$)/)?.[1] ??
          child.getAttribute('data-language')?.match(/^[\w#+.-]{1,40}$/)?.[0] ??
          '';
        result.push({ type: 'code', language, children: rawRuns(code ?? child, { code: true }) });
      } else if (tag === 'UL' || tag === 'OL') {
        flush();
        const start = Number(child.getAttribute('start') ?? 1);
        result.push({
          type: 'list',
          ordered: tag === 'OL',
          start: Number.isSafeInteger(start) ? start : 1,
          items: Array.from(child.children)
            .filter((item) => item.tagName === 'LI' && !excluded(item))
            .map((item) => blocks(item, depth + 1)),
        });
      } else if (tag === 'TABLE') {
        flush();
        const rows = Array.from(child.querySelectorAll('tr')).filter(
          (row) => row.closest('table') === child && !excluded(row),
        );
        const cells = rows.map((row) =>
          Array.from(row.children).filter(
            (cell) => /^(TD|TH)$/.test(cell.tagName) && !excluded(cell),
          ),
        );
        const first = cells[0] ?? [];
        result.push({
          type: 'table',
          headerRows: first.some((cell) => cell.tagName === 'TH') ? 1 : 0,
          alignments: first.map((cell) => {
            const align =
              cell.getAttribute('align') ??
              (cell instanceof HTMLElement ? cell.style.textAlign : '');
            return align === 'left' || align === 'right' || align === 'center' ? align : null;
          }),
          rows: cells.map((row) => ({ cells: row.map((cell) => blocks(cell, depth + 1)) })),
        });
      } else if (tag === 'BLOCKQUOTE') {
        flush();
        result.push({ type: 'blockquote', children: blocks(child, depth + 1) });
      } else if (tag === 'HR') {
        flush();
        result.push({ type: 'rule' });
      } else if (/^(DIV|SECTION|ARTICLE|MAIN|FIGURE|FIGCAPTION)$/.test(tag)) {
        flush();
        result.push(...blocks(child, depth + 1));
      } else pending.push(...inline(child));
    }
    flush();
    return result;
  }
  const content: MessageContent = { blocks: blocks(root), gaps: [] };
  const covered = contentTextRuns(content)
    .flatMap((run) => run.mappings)
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const span of covered) {
    if (span.start > cursor) content.gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < projection.text.length)
    content.gaps.push({ start: cursor, end: projection.text.length });
  return content;
}
