import type { Highlight } from '../types';
import { highlightSegments } from '../content/highlighter';
export function HighlightText({ text, highlights }: { text: string; highlights: Highlight[] }) {
  return (
    <>
      {highlightSegments(text, highlights).map((segment) => {
        const highlight = segment.highlights.at(-1);
        return highlight ? (
          <mark
            key={segment.start}
            data-highlight-id={highlight.id}
            className={`highlight-${highlight.color}`}
            title={segment.highlights.map((h) => h.note || h.color).join(' · ')}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={segment.start}>{segment.text}</span>
        );
      })}
    </>
  );
}
