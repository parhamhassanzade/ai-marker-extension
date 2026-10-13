import { jsPDF } from 'jspdf';
import type { HighlightColor } from '../types';
import type { TextRun } from './textLayout';
export const hasArabic = (text: string) => /\p{Script=Arabic}/u.test(text);
export const isRtlParagraph = (text: string) => hasArabic(text.match(/\p{L}/u)?.[0] ?? '');
interface BidiEngine {
  doBidiReorder(text: string, map: number[]): string;
}
interface BidiConstructor {
  new (options: Record<string, boolean>): BidiEngine;
}
export interface VisualRun extends TextRun {
  font: 'NotoSans' | 'NotoNaskhArabic';
}
// Preserve highlight identity while joining letters and reordering mixed-direction
// text. A lam-alef ligature maps to both original letters; selecting either colors
// the indivisible glyph. ZWNJ remains present during shaping, then is not painted.
export function visualRuns(
  pdf: jsPDF,
  runs: TextRun[],
  rtl: boolean,
  fontFor: (char: string) => VisualRun['font'],
): VisualRun[] {
  const text = runs.map((run) => run.text).join('');
  if (!text) return [];
  const colors = runs.flatMap((run) => Array.from({ length: run.text.length }, () => run.color));
  const normalizedColors: (HighlightColor | undefined)[] = [];
  let logicalOffset = 0;
  for (const char of text) {
    normalizedColors.push(
      ...Array.from({ length: char.normalize('NFKC').length }, () => colors[logicalOffset]),
    );
    logicalOffset += char.length;
  }
  const shaped = pdf.processArabic(text);
  const shapedColors: (HighlightColor | undefined)[] = [];
  let source = 0;
  for (const char of shaped) {
    const length = char.normalize('NFKC').length;
    const color = normalizedColors
      .slice(source, source + length)
      .reverse()
      .find((value) => value !== undefined);
    for (let i = 0; i < char.length; i++) shapedColors.push(color);
    source += length;
  }
  const Engine = (jsPDF as unknown as { __bidiEngine__: BidiConstructor }).__bidiEngine__;
  const engine = new Engine({
    isInputVisual: false,
    isInputRtl: rtl,
    isOutputVisual: true,
    isOutputRtl: false,
    isSymmetricSwapping: true,
  });
  const indices: number[] = [];
  const visual = engine.doBidiReorder(shaped, indices);
  const result: VisualRun[] = [];
  let offset = 0;
  for (const char of visual) {
    const color = shapedColors[indices[offset] ?? offset];
    offset += char.length;
    if (/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(char)) continue;
    const font = fontFor(char);
    const last = result.at(-1);
    if (last && last.color === color && last.font === font) last.text += char;
    else result.push({ text: char, color, font });
  }
  return result;
}
