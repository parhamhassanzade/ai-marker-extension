import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractMessages, cleanMessageText } from '../src/content/chatgpt/extractor';
import {
  extractMessages as legacyExtract,
  cleanMessageText as legacyText,
} from './helpers/legacyExtractor';
import {
  contentTextRuns,
  canonicalOffset,
  runOffset,
  safeLink,
  type ContentBlock,
} from '../src/content/model/types';
import { isMessageContent } from '../src/content/model/validation';
import { highlightSegments, resolveAnchor } from '../src/content/highlighter';
import { isCommand } from '../src/storage/validation';
import type { Highlight } from '../src/types';

function fixture(name = 'chatgpt-rich.html') {
  document.documentElement.innerHTML = readFileSync(`tests/fixtures/${name}`, 'utf8');
  return extractMessages().find((message) => message.role === 'assistant')!;
}
function allBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.flatMap((block): ContentBlock[] => [
    block,
    ...(block.type === 'blockquote'
      ? allBlocks(block.children)
      : block.type === 'list'
        ? block.items.flatMap(allBlocks)
        : block.type === 'table'
          ? block.rows.flatMap((row) => row.cells.flatMap(allBlocks))
          : []),
  ]);
}

describe('canonical text compatibility', () => {
  for (const name of [
    'chatgpt-semantic.html',
    'chatgpt-live-layout.html',
    'chatgpt-rich.html',
    'chatgpt-rich-persian.html',
  ]) {
    it(`is byte-identical to the frozen pre-change extractor: ${name}`, () => {
      fixture(name);
      const oldMessages = legacyExtract();
      const messages = extractMessages();
      expect(
        messages.map(({ content: _content, contentVersion: _version, ...message }) => message),
      ).toEqual(oldMessages);
      expect(Buffer.from(JSON.stringify(messages.map((m) => m.text)))).toEqual(
        Buffer.from(JSON.stringify(oldMessages.map((m) => m.text))),
      );
      for (const message of messages)
        if (message.content) expect(isMessageContent(message.content, message.text)).toBe(true);
    });
  }
  it('retains PRE whitespace, CR removal, hidden PRE descendants, nested separators, emoji and repeated text exactly', () => {
    document.body.innerHTML =
      '<main><div data-message-author-role="assistant"><div style="white-space:pre-wrap"> leading  text\n next </div><p> • <strong>•</strong> 1. 1. </p><ul><li>1.<ol start="2"><li>2.</li></ol></li></ul><table><tr><td>|</td><td>|</td></tr></table><pre>\r\n  😀\t x\r\n<span style="display:none">legacy PRE text</span><button>Copy</button>\n </pre><br>end</div></main>';
    const root = document.querySelector<HTMLElement>('[data-message-author-role]')!;
    expect(cleanMessageText(root)).toBe(legacyText(root));
    const message = extractMessages()[0]!;
    expect(isMessageContent(message.content, message.text)).toBe(true);
  });
  it('leaves user messages plain and preserves line breaks and fences', () => {
    fixture();
    const user = extractMessages()[0]!;
    expect(user.contentVersion).toBeUndefined();
    expect(user.content).toBeUndefined();
    expect(user.text).toContain('\n```text\nuser code\n```');
  });
});

describe('sanitized structured capture', () => {
  it('captures every block and inline style without modifying source DOM', () => {
    const message = fixture();
    const before = document.documentElement.outerHTML;
    const again = extractMessages().find((m) => m.id === message.id)!;
    expect(document.documentElement.outerHTML).toBe(before);
    expect(again.content).toEqual(message.content);
    expect(message.contentVersion).toBe(1);
    const blocks = allBlocks(message.content!.blocks);
    expect(blocks.filter((b) => b.type === 'heading').map((b) => b.level)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(blocks.some((b) => b.type === 'blockquote')).toBe(true);
    expect(blocks.some((b) => b.type === 'rule')).toBe(true);
    expect(blocks.filter((b) => b.type === 'list').map((b) => [b.ordered, b.start])).toEqual([
      [false, 1],
      [false, 1],
      [true, 7],
      [true, 3],
      [false, 1],
    ]);
    const table = blocks.find((b) => b.type === 'table')!;
    expect(table.headerRows).toBe(1);
    expect(table.alignments).toEqual(['left', 'right', 'center']);
    expect(table.rows).toHaveLength(3);
    const code = blocks.find((b) => b.type === 'code')!;
    expect(code.language).toBe('python');
    expect(code.children.map((run) => run.text).join('')).toContain('\n    return x + 1');
    const runs = contentTextRuns(message.content!);
    expect(runs.some((r) => r.marks.bold && r.marks.italic)).toBe(true);
    expect(runs.some((r) => r.marks.strike)).toBe(true);
    expect(runs.some((r) => r.marks.code)).toBe(true);
    expect(runs.filter((r) => r.marks.href).map((r) => r.marks.href)).toEqual([
      'https://example.com/learn?q=1&x=2',
      'http://example.com/',
      'mailto:study@example.com',
    ]);
    const serialized = JSON.stringify(message.content);
    for (const forbidden of [
      '<script',
      'onclick',
      'javascript:',
      'data:text/html',
      'file://',
      'Hidden secret',
      'Copy response',
      'window.untrusted',
      'invalid.example',
    ])
      expect(serialized).not.toContain(forbidden);
  });
  it('keeps LaTeX source once, preserves display mode, and creates explicit unsupported placeholders', () => {
    const message = fixture();
    const inlines = allBlocks(message.content!.blocks).flatMap((block) =>
      block.type === 'paragraph' || block.type === 'heading' ? block.children : [],
    );
    const math = inlines.filter((item) => item.type === 'math');
    expect(math.map((item) => item.latex)).toEqual([
      'E = mc^2',
      '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
      'x_i + y_i',
    ]);
    expect(math.map((item) => item.display)).toEqual([false, true, false]);
    expect(inlines.filter((item) => item.type === 'unsupported').map((item) => item.label)).toEqual(
      [
        '[image not captured]',
        '[canvas not captured]',
        '[attachment not captured]',
        '[interactive content not captured]',
      ],
    );
  });
  it('allows only HTTP, HTTPS and mailto links', () => {
    for (const value of [
      'javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,x',
      'file:///tmp/a',
      'ftp://example.com',
      'blob:https://example.com/x',
      '/relative',
      '#fragment',
    ])
      expect(safeLink(value)).toBeUndefined();
    expect(safeLink('HTTPS://EXAMPLE.COM')).toBe('https://example.com/');
    expect(safeLink('mailto:user@example.com')).toBe('mailto:user@example.com');
  });
  it('rejects over-limit formatting explicitly without mutating the page or truncating LaTeX', () => {
    document.body.innerHTML =
      '<main><div data-message-author-role="assistant"><p>' +
      '<span>'.repeat(40) +
      'Saved text' +
      '</span>'.repeat(40) +
      '</p></div></main>';
    const original = document.body.innerHTML;
    expect(() => extractMessages()).toThrow('safe nesting or node limits');
    expect(document.body.innerHTML).toBe(original);
    document.body.innerHTML =
      '<main><div data-message-author-role="assistant"><span data-latex="' +
      'x'.repeat(100_001) +
      '"></span></div></main>';
    expect(() => extractMessages()).toThrow('100,000 character capture limit');
  });
});

describe('offset and anchor mappings', () => {
  for (const name of ['chatgpt-rich.html', 'chatgpt-rich-persian.html']) {
    it(`maps every text code unit both ways without drift: ${name}`, () => {
      const message = fixture(name);
      const runs = contentTextRuns(message.content!);
      for (const run of runs)
        for (let i = 0; i < run.text.length; i++) {
          const offset = canonicalOffset(run, i)!;
          expect(message.text[offset]).toBe(run.text[i]);
          expect(runOffset(run, offset)).toBe(i);
        }
      const pieces = [...runs.flatMap((run) => run.mappings), ...message.content!.gaps].sort(
        (a, b) => a.start - b.start,
      );
      expect(pieces.map((part) => message.text.slice(part.start, part.end)).join('')).toBe(
        message.text,
      );
    });
  }
  for (const quote of [
    'bold and italic phrase',
    'saved idea\n• Nested idea',
    'Gradient descent | 42',
    'def step(x):\n    return x + 1',
  ]) {
    it(`preserves highlights across formatting: ${JSON.stringify(quote)}`, () => {
      const message = fixture();
      const selection =
        quote === 'Gradient descent | 42'
          ? message.text.slice(message.text.indexOf('Gradient'), message.text.indexOf('42') + 2)
          : quote;
      if (quote === 'Gradient descent | 42') expect(selection.replace(/\s+/g, ' ')).toBe(quote);
      const start = message.text.indexOf(selection);
      expect(start).toBeGreaterThanOrEqual(0);
      const highlight = {
        id: 'h',
        text: selection,
        color: 'green',
        anchor: {
          start,
          end: start + selection.length,
          prefix: message.text.slice(Math.max(0, start - 40), start),
          suffix: message.text.slice(start + selection.length, start + selection.length + 40),
        },
      } as Highlight;
      expect(resolveAnchor(message.text, highlight)).toBe(start);
      const pieces = highlightSegments(message.text, [highlight]);
      expect(
        pieces
          .filter((p) => p.highlights.length)
          .map((p) => p.text)
          .join(''),
      ).toBe(selection);
      for (const run of contentTextRuns(message.content!))
        for (const map of run.mappings) {
          const from = Math.max(start, map.start),
            to = Math.min(start + selection.length, map.end);
          if (to > from)
            expect(run.text.slice(runOffset(run, from), runOffset(run, to))).toBe(
              message.text.slice(from, to),
            );
        }
    });
  }
  it('distinguishes repeated passages by exact offsets rather than first-match alignment', () => {
    const message = fixture();
    const repeated = contentTextRuns(message.content!)
      .flatMap((run) => run.mappings)
      .filter((map) => message.text.slice(map.start, map.end) === 'Repeated');
    expect(repeated).toHaveLength(2);
    expect(repeated[1]!.start).toBeGreaterThan(repeated[0]!.end);
  });
});

it('preserves pre-wrap newlines within a run and explicit BR structure', () => {
  document.body.innerHTML =
    '<main><div data-message-author-role="assistant"><p style="white-space:pre-wrap">first\n  second\n\nthird</p><p>line<br>next</p></div></main>';
  const message = extractMessages()[0]!;
  const runs = contentTextRuns(message.content!);
  expect(runs[0]!.text).toBe('first\nsecond\n\nthird');
  for (const run of runs)
    for (let i = 0; i < run.text.length; i++)
      expect(message.text[canonicalOffset(run, i)!]).toBe(run.text[i]);
  expect(message.content!.blocks[1]).toMatchObject({
    type: 'paragraph',
    children: [{ type: 'text' }, { type: 'break' }, { type: 'text' }],
  });
  expect(isMessageContent(message.content, message.text)).toBe(true);
});

it('retains unsupported-only and math-only answers without inventing canonical characters', () => {
  document.body.innerHTML =
    '<main><div data-message-author-role="assistant"><img alt="diagram"><span data-latex="x^2"></span></div></main>';
  const message = extractMessages()[0]!;
  expect(message.text).toBe('');
  expect(message.content!.blocks).toHaveLength(1);
  expect(isMessageContent(message.content, message.text)).toBe(true);
  expect(message.content!.blocks[0]).toMatchObject({
    type: 'paragraph',
    children: [{ type: 'unsupported' }, { type: 'math', latex: 'x^2' }],
  });
});

describe('worker content validation', () => {
  const command = (message: unknown) => ({
    type: 'activate',
    snapshot: {
      platform: 'ChatGPT',
      conversationId: 'c',
      title: 'Study',
      website: 'https://chatgpt.com/c/c',
      messages: [message],
    },
  });
  it('accepts current content and legacy plain messages, preserving the JSON schema version', () => {
    const message = fixture();
    expect(isCommand(command(message))).toBe(true);
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
    expect(isCommand(command({ id: 'old', role: 'assistant', text: 'Legacy' }))).toBe(true);
  });
  it('rejects unknown versions, partial content pairs, unsafe links, raw HTML and invalid mappings', () => {
    const message = fixture();
    for (const invalid of [
      { ...message, contentVersion: 2 },
      { ...message, content: undefined },
      { ...message, contentVersion: undefined },
      { ...message, content: { ...message.content, html: '<b>unsafe</b>' } },
    ])
      expect(isCommand(command(invalid))).toBe(false);
    const content = structuredClone(message.content!);
    const run = contentTextRuns(content)[0]!;
    run.marks.href = 'javascript:alert(1)';
    expect(isMessageContent(content, message.text)).toBe(false);
    delete run.marks.href;
    run.mappings[0]!.start++;
    expect(isMessageContent(content, message.text)).toBe(false);
  });
  it('rejects overlapping/uncovered text, oversized math and excessive nesting', () => {
    const message = fixture();
    const content = structuredClone(message.content!);
    content.gaps.push({ start: 0, end: 1 });
    expect(isMessageContent(content, message.text)).toBe(false);
    expect(
      isMessageContent(
        {
          blocks: [
            {
              type: 'paragraph',
              children: [
                { type: 'math', latex: 'x'.repeat(100_001), display: false, children: [] },
              ],
            },
          ],
          gaps: [],
        },
        '',
      ),
    ).toBe(false);
    let block: unknown = { type: 'paragraph', children: [] };
    for (let i = 0; i < 40; i++) block = { type: 'blockquote', children: [block] };
    expect(isMessageContent({ blocks: [block], gaps: [] }, '')).toBe(false);
  });
});
