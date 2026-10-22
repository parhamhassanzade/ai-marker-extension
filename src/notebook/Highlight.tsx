import { Fragment, type ReactNode } from 'react';
import type { Highlight } from '../types';
import { highlightSegments } from '../content/highlighter';
export interface TextInsert {
  /** Canonical offset in the text; the node renders before this character. */
  offset: number;
  key: string;
  node: ReactNode;
}
export function HighlightText({
  text,
  highlights,
  inserts = [],
}: {
  text: string;
  highlights: Highlight[];
  inserts?: TextInsert[];
}) {
  const pending = [...inserts].sort((a, b) => a.offset - b.offset);
  const output: ReactNode[] = [];
  const flush = (before: number) => {
    while (pending.length && pending[0]!.offset <= before) {
      const insert = pending.shift()!;
      output.push(<Fragment key={`insert-${insert.key}`}>{insert.node}</Fragment>);
    }
  };
  for (const segment of highlightSegments(text, highlights)) {
    const highlight = segment.highlights.at(-1);
    // Split a segment at each insert so images appear at their original position.
    let start = segment.start;
    const end = segment.start + segment.text.length;
    while (start < end) {
      flush(start);
      const next = pending.length && pending[0]!.offset < end ? pending[0]!.offset : end;
      const piece = text.slice(start, next);
      output.push(
        highlight ? (
          <mark
            key={start}
            data-highlight-id={highlight.id}
            className={`highlight-${highlight.color}`}
            title={segment.highlights.map((h) => h.note || h.color).join(' · ')}
          >
            {piece}
          </mark>
        ) : (
          <span key={start}>{piece}</span>
        ),
      );
      start = next;
    }
  }
  flush(Number.POSITIVE_INFINITY);
  return <>{output}</>;
}
