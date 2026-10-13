import { describe, it, expect } from 'vitest';
import {
  anchorSelection,
  resolveAnchor,
  paintHighlight,
  removeMarks,
} from '../src/content/highlighter';
import type { Highlight } from '../src/types';
describe('text anchors and DOM preservation', () => {
  it('wraps a selection spanning formatted nodes without breaking links', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p>Hello <strong>important</strong> <a href="https://example.com">world</a>.</p>';
    const range = document.createRange();
    range.setStart(root.querySelector('strong')!.firstChild!, 0);
    range.setEnd(root.querySelector('a')!.firstChild!, 5);
    const quote = anchorSelection(root, range);
    const h = { ...quote, color: 'yellow', id: 'h', note: '' } as Highlight;
    paintHighlight(root, h);
    expect(root.querySelectorAll('mark')).toHaveLength(3);
    expect(root.querySelector('a')?.href).toBe('https://example.com/');
    removeMarks(root);
    expect(root.textContent).toBe('Hello important world.');
    expect(root.querySelector('strong')?.textContent).toBe('important');
  });
  it('reattaches after preceding text changes and rejects ambiguous passages', () => {
    const h = { text: 'quote', anchor: { start: 7, end: 12, prefix: 'before ', suffix: ' after' } };
    expect(resolveAnchor('New before quote after', h)).toBe(11);
    expect(
      resolveAnchor('quote and quote', {
        text: 'quote',
        anchor: { start: 3, end: 8, prefix: '', suffix: '' },
      }),
    ).toBeUndefined();
  });
  it('safely nests overlapping annotations and removes them cleanly', () => {
    const root = document.createElement('p');
    root.textContent = 'one two three';
    paintHighlight(root, {
      id: 'a',
      color: 'green',
      note: '',
      text: 'one two',
      anchor: { start: 0, end: 7, prefix: '', suffix: ' three' },
    } as Highlight);
    paintHighlight(root, {
      id: 'b',
      color: 'red',
      note: '',
      text: 'two three',
      anchor: { start: 4, end: 13, prefix: 'one ', suffix: '' },
    } as Highlight);
    removeMarks(root);
    expect(root.textContent).toBe('one two three');
    expect(root.querySelector('mark')).toBeNull();
  });
});
