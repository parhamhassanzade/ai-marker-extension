import { jsPDF } from 'jspdf';
import { hasArabic, isRtlParagraph, visualRuns } from './bidirectional';
import { resolveAnchor } from '../content/highlighter';
import { chaptersOf } from '../notebook/chapters';
import { layoutHighlightedText, PDF_HIGHLIGHT_COLORS } from './textLayout';
import type { Highlight, Notebook } from '../types';
const accents = { yellow: [170, 126, 29], green: [44, 128, 81], red: [181, 66, 64] } as const;
const fontPromises = new Map<string, Promise<string>>();
async function loadFont(name: 'NotoSans' | 'NotoNaskhArabic') {
  let pending = fontPromises.get(name);
  if (!pending) {
    const url =
      name === 'NotoSans'
        ? new URL('../../public/fonts/NotoSans-Regular.ttf', import.meta.url)
        : new URL('../../public/fonts/NotoNaskhArabic-Regular.ttf', import.meta.url);
    pending = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error('Bundled PDF font could not be loaded.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      })
      .catch((error) => {
        fontPromises.delete(name);
        throw error;
      });
    fontPromises.set(name, pending);
  }
  return pending;
}
export function createNotebookPdf(notebook: Notebook, font?: string, arabicFont?: string): jsPDF {
  if (!notebook.messages.some((message) => message.text.trim()))
    throw new Error(
      'This notebook has no conversation messages. Activate Notebook Mode and import the conversation before exporting.',
    );
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  if (font) {
    pdf.addFileToVFS('NotoSans.ttf', font);
    pdf.addFont('NotoSans.ttf', 'NotoSans', 'normal');
    pdf.setFont('NotoSans');
  }
  if (arabicFont) {
    pdf.addFileToVFS('NotoNaskhArabic.ttf', arabicFont);
    pdf.addFont('NotoNaskhArabic.ttf', 'NotoNaskhArabic', 'normal');
  }
  const metadataByFont = new Map<string, { characterToGlyph?: (code: number) => number }>();
  for (const name of [font && 'NotoSans', arabicFont && 'NotoNaskhArabic'].filter(
    Boolean,
  ) as string[]) {
    pdf.setFont(name);
    metadataByFont.set(name, pdf.getFont().metadata);
  }
  const hasGlyph = (name: string, code: number) =>
    !!metadataByFont.get(name)?.characterToGlyph?.(code);
  const fontFor = (char: string): 'NotoSans' | 'NotoNaskhArabic' =>
    arabicFont &&
    hasGlyph('NotoNaskhArabic', char.codePointAt(0)!) &&
    (hasArabic(char) || !font || !hasGlyph('NotoSans', char.codePointAt(0)!))
      ? 'NotoNaskhArabic'
      : 'NotoSans';
  const printable = (text: string) =>
    font
      ? Array.from(text, (char) => {
          const code = char.codePointAt(0)!;
          return code < 32 ||
            /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(char) ||
            (code <= 0xffff &&
              (hasGlyph('NotoSans', code) || (arabicFont && hasGlyph('NotoNaskhArabic', code))))
            ? char
            : `[U+${code.toString(16).toUpperCase()}]`;
        }).join('')
      : text;
  const setRunFont = (name: string) => pdf.setFont(font ? name : 'helvetica');
  const visualWidth = (text: string, rtl: boolean) => {
    if (!hasArabic(text) && !rtl) {
      setRunFont('NotoSans');
      return pdf.getTextWidth(text);
    }
    return visualRuns(pdf, [{ text }], rtl, fontFor).reduce((sum, run) => {
      setRunFont(run.font);
      return sum + pdf.getTextWidth(run.text);
    }, 0);
  };
  const left = 19;
  const width = 172;
  const bottom = 277;
  let y = 25;
  function line(
    text: string,
    size = 10,
    color: readonly number[] = [44, 49, 42],
    space = 3,
    highlights?: Highlight[],
  ) {
    pdf.setFontSize(size);
    pdf.setTextColor(color[0] ?? 44, color[1] ?? 49, color[2] ?? 42);
    const leading = size * 0.3528 * 1.65;
    const resolved = (highlights ?? [])
      .map((h) => ({ highlight: h, start: resolveAnchor(text, h) }))
      .filter((h) => h.start !== undefined);
    let offset = 0;
    for (const paragraph of text.split('\n')) {
      const rtl = isRtlParagraph(paragraph);
      const local: Highlight[] = [];
      for (const { highlight: h, start: position } of resolved) {
        const start = Math.max(offset, position!);
        const end = Math.min(offset + paragraph.length, position! + h.text.length);
        if (end > start)
          local.push({
            ...h,
            text: text.slice(start, end),
            anchor: { start: start - offset, end: end - offset, prefix: '', suffix: '' },
          });
      }
      const rows = layoutHighlightedText(
        paragraph,
        local,
        width,
        (value) => visualWidth(value, rtl),
        printable,
      );
      offset += paragraph.length + 1;
      for (const row of rows) {
        if (y + leading > bottom) {
          pdf.addPage();
          y = 23;
        }
        const runs = visualRuns(pdf, row.runs, rtl, fontFor);
        const lengths = runs.map((run) => {
          setRunFont(run.font);
          return pdf.getTextWidth(run.text);
        });
        let x = rtl ? left + width - lengths.reduce((sum, length) => sum + length, 0) : left;
        for (let i = 0; i < runs.length; i++) {
          const run = runs[i]!;
          const length = lengths[i]!;
          setRunFont(run.font);
          if (run.color) {
            const fill = PDF_HIGHLIGHT_COLORS[run.color];
            pdf.setFillColor(fill[0], fill[1], fill[2]);
            pdf.rect(x, y - size * 0.3528 * 0.9, length, size * 0.3528 * 1.35, 'F');
          }
          // Text is already shaped/reordered; disable jsPDF's second bidi pass.
          pdf.text(run.text, x, y, {
            isInputVisual: true,
            isOutputVisual: true,
            isInputRtl: false,
            isOutputRtl: false,
          });
          x += length;
        }
        y += leading;
      }
    }
    y += space;
  }
  function keepSection(required = 20) {
    if (y + required > bottom) {
      pdf.addPage();
      y = 23;
    }
  }
  const labels = { yellow: 'Highlight', green: 'Definition', red: 'Important' };
  pdf.setProperties({
    title: notebook.title,
    author: 'AI Notebook',
    subject: 'AI conversation notebook',
  });
  line('AI Notebook', 23, [52, 74, 40], 5);
  line(notebook.title, 16, [44, 49, 42], 5);
  line(
    `Platform: ${notebook.platform}    Date: ${new Date(notebook.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`,
    9,
  );
  line(`Conversation: ${notebook.conversationTitle}`, 9);
  line(`Source: ${notebook.website}`, 8);
  line(
    `Status: ${notebook.finishedAt ? 'Finished' : 'In progress'}    Insights: ${notebook.highlights.length}`,
    9,
    [100, 107, 96],
    9,
  );
  for (const chapter of chaptersOf(notebook.messages)) {
    if (chapter.number > 1) y += 7;
    keepSection(35);
    line(`Chapter ${chapter.number}`, 16, [52, 74, 40], 5);
    for (const message of chapter.messages) {
      keepSection();
      line(message.role === 'user' ? 'User Question' : 'AI Answer', 11, [52, 74, 40]);
      if (message.timestamp) line(new Date(message.timestamp).toLocaleString(), 8, [100, 107, 96]);
      const highlights = notebook.highlights.filter((h) => h.messageId === message.id);
      line(message.text, 10, undefined, 5, highlights);
      if (highlights.length) {
        keepSection(35);
        line('Highlighted Notes', 12);
      }
      for (const h of highlights) {
        keepSection();
        line(`${labels[h.color]} · ${new Date(h.createdAt).toLocaleString()}`, 9, accents[h.color]);
        line(h.text, 10, undefined, 3, [
          { ...h, anchor: { start: 0, end: h.text.length, prefix: '', suffix: '' } },
        ]);
        if (h.note) {
          keepSection(20);
          line('User note', 9, [100, 107, 96]);
          line(h.note);
        }
      }
    }
  }
  const unmatched = notebook.highlights.filter(
    (h) => !notebook.messages.some((m) => m.id === h.messageId),
  );
  if (unmatched.length) {
    keepSection(35);
    line('Additional captured insights', 12);
    for (const h of unmatched) {
      line(labels[h.color], 9, accents[h.color]);
      line(h.text);
      if (h.note) line(`User note: ${h.note}`);
    }
  }
  const total = pdf.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    pdf.setPage(page);
    pdf.setDrawColor(215, 221, 210);
    pdf.line(left, 284, 191, 284);
    pdf.setFont(font ? 'NotoSans' : 'helvetica');
    pdf.setFontSize(8);
    pdf.setTextColor(110, 117, 105);
    pdf.text('AI Notebook · Private notebook', left, 290);
    pdf.text(`${page} / ${total}`, 191, 290, { align: 'right' });
  }
  return pdf;
}
export async function exportNotebookPdf(notebook: Notebook) {
  const arabic = hasArabic(
    [
      notebook.title,
      notebook.conversationTitle,
      ...notebook.messages.map((m) => m.text),
      ...notebook.highlights.flatMap((h) => [h.text, h.note]),
    ].join('\n'),
  );
  const [font, arabicFont] = await Promise.all([
    loadFont('NotoSans'),
    arabic ? loadFont('NotoNaskhArabic') : Promise.resolve(undefined),
  ]);
  const pdf = createNotebookPdf(notebook, font, arabicFont);
  const safeTitle =
    notebook.title
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .slice(0, 80) || 'AI Notebook';
  pdf.save(`${safeTitle}.pdf`);
}
