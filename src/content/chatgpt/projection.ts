import { UI_SELECTOR, isHidden } from './detector';

interface NodeSpan {
  node: Node;
  start: number;
  end: number;
}
interface Projected {
  text: string;
  spans: NodeSpan[];
}
export type MessageProjection = Projected;
const literal = (text: string): Projected => ({ text, spans: [] });
function join(parts: Projected[]): Projected {
  let offset = 0;
  const spans: NodeSpan[] = [];
  for (const part of parts) {
    for (const span of part.spans)
      spans.push({ ...span, start: span.start + offset, end: span.end + offset });
    offset += part.text.length;
  }
  return { text: parts.map((part) => part.text).join(''), spans };
}
function slice(value: Projected, start: number, end = value.text.length): Projected {
  // Spans are in canonical order. Locate the relevant interval without scanning
  // every span once for every newline in a large message.
  let low = 0;
  let high = value.spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (value.spans[middle]!.end <= start) low = middle + 1;
    else high = middle;
  }
  const selected: NodeSpan[] = [];
  for (let i = low; i < value.spans.length && value.spans[i]!.start < end; i++)
    selected.push(value.spans[i]!);
  return {
    text: value.text.slice(start, end),
    spans: selected.map((span) => ({
      node: span.node,
      start: Math.max(start, span.start) - start,
      end: Math.min(end, span.end) - start,
    })),
  };
}
function trim(value: Projected, endOnly = false): Projected {
  const start = endOnly ? 0 : value.text.length - value.text.trimStart().length;
  return slice(value, start, Math.max(start, value.text.trimEnd().length));
}
function replace(
  value: Projected,
  pattern: RegExp,
  replacement: (match: RegExpExecArray) => Projected,
): Projected {
  const parts: Projected[] = [];
  let cursor = 0;
  for (const match of value.text.matchAll(pattern)) {
    parts.push(slice(value, cursor, match.index), replacement(match));
    cursor = match.index + match[0].length;
  }
  parts.push(slice(value, cursor));
  return join(parts);
}

// The 3.0.3 serializer's exact transformations, with optional provenance carried
// through trimming, synthetic separators, and protected PRE replacement. Frozen
// legacy-extractor tests enforce byte-identical output (not normalized equality).
export function projectMessageText(root: HTMLElement, trace = true): MessageProjection {
  const codeBlocks: Projected[] = [];
  const codeToken = `AI_NOTEBOOK_CODE_${crypto.randomUUID()}_`;
  function leaf(node: Node, text: string): Projected {
    return {
      text,
      spans: trace && text ? [{ node, start: 0, end: text.length }] : [],
    };
  }
  function preText(node: Node): Projected {
    if (node.nodeType === Node.TEXT_NODE)
      return leaf(node, (node.textContent ?? '').replace(/\r/g, ''));
    if (node instanceof Element && node.matches(UI_SELECTOR)) return literal('');
    return join(Array.from(node.childNodes, preText));
  }
  function visit(node: Node, pre = false): Projected {
    if (node.nodeType === Node.TEXT_NODE)
      return leaf(
        node,
        pre ? (node.textContent ?? '') : (node.textContent ?? '').replace(/\s+/g, ' '),
      );
    if (!(node instanceof HTMLElement) || node.matches(UI_SELECTOR) || isHidden(node))
      return literal('');
    const tag = node.tagName;
    if (tag === 'BR') return literal('\n');
    if (tag === 'PRE') {
      codeBlocks.push(trim(join(Array.from(node.childNodes, preText)), true));
      return literal(`\n\n${codeToken}${codeBlocks.length - 1}END\n\n`);
    }
    if (
      /^H[1-6]$/.test(tag) &&
      /^(you said|chatgpt said|user|assistant)\s*:?$/i.test(node.textContent?.trim() ?? '')
    )
      return literal('');
    const preserve =
      pre ||
      /pre/.test(getComputedStyle(node).whiteSpace) ||
      node.classList.contains('whitespace-pre-wrap');
    const children = join(Array.from(node.childNodes, (child) => visit(child, preserve)));
    if (tag === 'LI') {
      const list = node.parentElement;
      const index = list
        ? Array.from(list.children).indexOf(node) + Number(list.getAttribute('start') ?? 1)
        : 1;
      return join([
        literal(`\n${list?.tagName === 'OL' ? `${index}.` : '•'} `),
        trim(children),
        literal('\n'),
      ]);
    }
    if (tag === 'TD' || tag === 'TH') return join([trim(children), literal(' | ')]);
    if (tag === 'TR') return join([trim(children), literal('\n')]);
    if (/^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|H[1-6]|UL|OL|TABLE)$/.test(tag))
      return join([literal('\n'), trim(children), literal('\n')]);
    return children;
  }
  let value = replace(visit(root), / *\n */g, () => literal('\n'));
  value = replace(value, /\n{3,}/g, () => literal('\n\n'));
  value = trim(value);
  value = replace(
    value,
    new RegExp(`${codeToken}(\\d+)END`, 'g'),
    (match) => codeBlocks[Number(match[1])] ?? literal(''),
  );
  return value;
}
