import type { Highlight, HighlightColor } from '../types';
import { highlightSegments } from '../content/highlighter';
export interface TextRun {
  text: string;
  color?: HighlightColor;
}
export interface TextRow {
  text: string;
  runs: TextRun[];
}
interface Glyph {
  text: string;
  color?: HighlightColor;
}
export const PDF_HIGHLIGHT_COLORS = {
  yellow: [249, 223, 128],
  green: [167, 228, 191],
  red: [246, 168, 165],
} as const;
export function layoutHighlightedText(
  text: string,
  highlights: Highlight[],
  maxWidth: number,
  measure: (text: string) => number,
  printable: (text: string) => string = (value) => value,
): TextRow[] {
  const rows: TextRow[] = [];
  let glyphs: Glyph[] = [];
  function pushRow(row: Glyph[]) {
    const runs: TextRun[] = [];
    for (const glyph of row) {
      const last = runs.at(-1);
      if (last && last.color === glyph.color) last.text += glyph.text;
      else runs.push({ ...glyph });
    }
    rows.push({ text: row.map((g) => g.text).join(''), runs });
  }
  function add(glyph: Glyph) {
    glyphs.push(glyph);
    if (glyphs.length > 1 && measure(glyphs.map((g) => g.text).join('')) > maxWidth) {
      // Break after the last space that fits; preserve those spaces and code indentation.
      let split = -1;
      for (let i = glyphs.length - 2; i > 0; i--)
        if (/^\s+$/.test(glyphs[i]!.text)) {
          split = i + 1;
          break;
        }
      if (split < 1) split = glyphs.length - 1;
      pushRow(glyphs.slice(0, split));
      glyphs = glyphs.slice(split);
    }
  }
  for (const segment of highlightSegments(text, highlights)) {
    const color = segment.highlights.at(-1)?.color;
    for (const char of Array.from(segment.text)) {
      if (char === '\r') continue;
      if (char === '\n') {
        pushRow(glyphs);
        glyphs = [];
        continue;
      }
      const display = char === '\t' ? '    ' : printable(char);
      // Glyph replacements can expand an emoji into a codepoint token. Carry its
      // highlight through that transform, then allow even long tokens to wrap.
      for (const glyph of Array.from(display)) add({ text: glyph, color });
    }
  }
  pushRow(glyphs);
  return rows;
}
