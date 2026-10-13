import { it, expect } from 'vitest';
import { layoutHighlightedText } from '../src/pdf/textLayout';
import { createNotebookPdf } from '../src/pdf/notebookExporter';
import type { Highlight, Notebook } from '../src/types';
function highlight(text: string, start: number, color: Highlight['color'] = 'yellow'): Highlight {
  return {
    id: color,
    platform: 'ChatGPT',
    conversationId: 'c',
    website: 'https://chatgpt.com/c/c',
    messageId: 'a',
    text,
    color,
    note: '',
    createdAt: '2026-10-13T00:00:00Z',
    anchor: { start, end: start + text.length, prefix: '', suffix: '' },
  };
}
it('retains a sentence highlight on every wrapped line and keeps the full answer', () => {
  const text = 'Start. This entire sentence is highlighted over several lines. End.';
  const quote = 'This entire sentence is highlighted over several lines.';
  const rows = layoutHighlightedText(text, [highlight(quote, 7)], 20, (value) => value.length);
  expect(rows.map((row) => row.text).join('')).toBe(text);
  expect(
    rows
      .flatMap((row) => row.runs)
      .filter((run) => run.color)
      .map((run) => run.text)
      .join(''),
  ).toBe(quote);
  expect(rows.filter((row) => row.runs.some((run) => run.color)).length).toBeGreaterThan(1);
});
it('uses the latest annotation color for overlaps and carries colors through glyph substitutions', () => {
  const rows = layoutHighlightedText(
    'abc😀def',
    [highlight('abc😀', 0, 'yellow'), highlight('😀def', 3, 'red')],
    100,
    (value) => value.length,
    (char) => (char === '😀' ? '[U+1F600]' : char),
  );
  expect(rows[0]?.runs).toEqual([
    { text: 'abc', color: 'yellow' },
    { text: '[U+1F600]def', color: 'red' },
  ]);
});
it('preserves code indentation, explicit newlines and long unbroken highlights', () => {
  const text = '  code()\nabcdefghijklmnop';
  const rows = layoutHighlightedText(
    text,
    [highlight('abcdefghijklmnop', 9, 'green')],
    5,
    (value) => value.length,
  );
  expect(rows.every((row) => row.text.length <= 5)).toBe(true);
  expect(rows.map((row) => row.text).join('')).toBe(text.replace('\n', ''));
  expect(
    rows
      .flatMap((row) => row.runs)
      .filter((run) => run.color)
      .map((run) => run.text)
      .join(''),
  ).toBe('abcdefghijklmnop');
});
it('draws colored fill rectangles behind body text on every page containing the selection', () => {
  const text = 'A highlighted sentence repeated. '.repeat(1200);
  const h = highlight(text, 0, 'green');
  const notebook = {
    id: 'n',
    title: 'Study',
    conversationTitle: 'Study',
    platform: 'ChatGPT',
    conversationId: 'c',
    website: h.website,
    createdAt: h.createdAt,
    updatedAt: h.createdAt,
    messages: [{ id: 'a', role: 'assistant', text }],
    highlights: [h],
  } as Notebook;
  const pdf = createNotebookPdf(notebook);
  expect(pdf.getNumberOfPages()).toBeGreaterThan(3);
  const pages = (pdf.internal as unknown as { pages: string[][] }).pages.filter(Boolean);
  expect(
    pages.filter((page) => page.some((command) => command.includes(' re'))).length,
  ).toBeGreaterThan(3);
});
