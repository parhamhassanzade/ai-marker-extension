import { jsPDF } from 'jspdf';
import { DONATION_URL, FEEDBACK_EMAIL, FEEDBACK_URL } from '../config';
import { hasArabic, isRtlParagraph, visualRuns } from './bidirectional';
import { resolveAnchor } from '../content/highlighter';
import { overviewOf } from '../knowledge/overview';
import { chaptersOf, chapterTitle } from '../notebook/chapters';
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
    measureWidth = width,
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
        measureWidth,
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
        let x = rtl ? left + measureWidth - lengths.reduce((sum, length) => sum + length, 0) : left;
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
  const chapters = chaptersOf(notebook.messages);
  const overview = overviewOf(notebook);
  // Quiet, book-like cover; the notebook's title is the visual anchor.
  pdf.setFillColor(248, 246, 239);
  pdf.rect(0, 0, 210, 297, 'F');
  y = 29;
  line('AI NOTEBOOK', 10, [87, 107, 75], 18);
  pdf.setDrawColor(182, 193, 163);
  pdf.line(left, y, left + 36, y);
  y += 18;
  line(notebook.title, 29, [44, 53, 39], 12);
  line('Questions worth asking. Ideas worth keeping.', 12, [111, 117, 104], 10);
  y = Math.max(y, 185);
  line(
    `${chapters.length} chapters   /   ${notebook.highlights.length} saved ${notebook.highlights.length === 1 ? 'idea' : 'ideas'}   /   ${notebook.highlights.filter((h) => h.note).length} personal ${notebook.highlights.filter((h) => h.note).length === 1 ? 'note' : 'notes'}`,
    10,
    [87, 107, 75],
    14,
  );
  line(
    `${notebook.platform} · ${new Date(notebook.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
    9,
    [111, 117, 104],
    3,
  );
  line(`Source: ${notebook.website}`, 7, [111, 117, 104], 3);
  const coverPages = pdf.getNumberOfPages();
  // Lay out the contents before reserving its pages. Actual destination page
  // numbers are filled after the chapter bodies are laid out, including wraps.
  const contents = [
    'Notebook overview',
    ...chapters.map(chapterTitle),
    ...(notebook.highlights.length ? ['Your saved highlights'] : []),
  ];
  const positions: { page: number; y: number; height: number }[] = [];
  let tocPage = 0;
  let tocY = 49;
  pdf.setFontSize(10);
  for (const title of contents) {
    const rows = layoutHighlightedText(
      title,
      [],
      151,
      (value) => visualWidth(value, isRtlParagraph(title)),
      printable,
    );
    const height = rows.length * 10 * 0.3528 * 1.65 + 5;
    if (tocY + height > bottom) {
      tocPage++;
      tocY = 49;
    }
    positions.push({ page: tocPage, y: tocY, height });
    tocY += height;
  }
  const tocPages = tocPage + 1;
  for (let i = 0; i < tocPages; i++) pdf.addPage();
  const destinations: number[] = [];
  pdf.addPage();
  y = 27;
  destinations.push(pdf.getNumberOfPages());
  line('Notebook overview', 22, [52, 74, 40], 10);
  if (overview.summary) {
    line('Your summary', 11, [87, 107, 75]);
    line(overview.summary, 11, undefined, 10);
  } else
    line(
      'A personal collection of the questions you explored and the ideas you chose to keep.',
      11,
      [111, 117, 104],
      10,
    );
  if (overview.topics.length) {
    line('Topics', 11, [87, 107, 75]);
    line(overview.topics.join(' · '), 10, undefined, 10);
  }
  if (overview.keyInsights.length) {
    line('Ideas to return to', 15, [52, 74, 40], 5);
    for (const insight of overview.keyInsights) {
      keepSection(25);
      line(insight.text, 10, undefined, 6);
    }
  }
  for (const chapter of chapters) {
    pdf.addPage();
    y = 27;
    destinations.push(pdf.getNumberOfPages());
    line(`CHAPTER ${String(chapter.number).padStart(2, '0')}`, 9, [111, 117, 104], 6);
    line(chapterTitle(chapter), 20, [52, 74, 40], 10);
    for (const message of chapter.messages) {
      keepSection(25);
      if (message.role === 'user') {
        pdf.setFillColor(239, 243, 234);
        pdf.roundedRect(left - 3, y - 5, width + 6, 11, 2, 2, 'F');
      }
      line(message.role === 'user' ? 'Your question' : 'AI response', 10, [87, 107, 75], 4);
      const highlights = notebook.highlights.filter((h) => h.messageId === message.id);
      line(message.text, 10, undefined, 10, highlights);
    }
  }
  if (notebook.highlights.length) {
    pdf.addPage();
    y = 27;
    destinations.push(pdf.getNumberOfPages());
    line('Your saved highlights', 22, [52, 74, 40], 9);
    line('A collection of the ideas you chose to keep.', 10, [111, 117, 104], 8);
    for (const highlight of notebook.highlights) {
      keepSection(35);
      const chapter = chapters.find((chapter) =>
        chapter.messages.some((message) => message.id === highlight.messageId),
      );
      line(
        `${labels[highlight.color]}${highlight.bookmarked ? ' · Bookmarked' : ''}${chapter ? ` · Chapter ${chapter.number}` : ''}`,
        9,
        accents[highlight.color],
        3,
      );
      line(highlight.text, 10, undefined, 4, [
        { ...highlight, anchor: { start: 0, end: highlight.text.length, prefix: '', suffix: '' } },
      ]);
      if (highlight.note) {
        keepSection(20);
        line('Your note', 9, [111, 117, 104]);
        line(highlight.note, 10, undefined, 4);
      }
      if (highlight.tags?.length)
        line(highlight.tags.map((tag) => `#${tag}`).join('  '), 9, [87, 107, 75], 5);
      y += 5;
    }
  }
  for (let i = 0; i < tocPages; i++) {
    pdf.setPage(coverPages + i + 1);
    y = 27;
    line(i ? 'Contents, continued' : 'Contents', 22, [52, 74, 40], 8);
  }
  positions.forEach((position, index) => {
    pdf.setPage(coverPages + position.page + 1);
    y = position.y;
    line(contents[index]!, 10, undefined, 5, undefined, 151);
    pdf.setFont(font ? 'NotoSans' : 'helvetica');
    pdf.setFontSize(10);
    pdf.setTextColor(111, 117, 104);
    pdf.text(String(destinations[index]), 191, position.y, { align: 'right' });
    pdf.link(left, position.y - 5, width, position.height, { pageNumber: destinations[index]! });
    pdf.setDrawColor(229, 232, 222);
    pdf.line(left, position.y + position.height - 3, 191, position.y + position.height - 3);
  });
  const total = pdf.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    pdf.setPage(page);
    pdf.setDrawColor(215, 221, 210);
    pdf.line(left, 282, 191, 282);
    pdf.setFont(font ? 'NotoSans' : 'helvetica');
    pdf.setFontSize(8);
    pdf.setTextColor(110, 117, 105);
    pdf.text('AI Notebook · Ideas worth keeping', left, 287);
    pdf.text(`${page} / ${total}`, 191, 287, { align: 'right' });
    const supportLabel = 'Support on Ko-fi';
    const supportWidth = pdf.getTextWidth(supportLabel);
    const supportX = 105 - supportWidth / 2;
    pdf.setTextColor(87, 107, 75);
    pdf.textWithLink(supportLabel, supportX, 287, { url: DONATION_URL });
    pdf.setDrawColor(87, 107, 75);
    pdf.line(supportX, 288, supportX + supportWidth, 288);
    pdf.setFontSize(7);
    const feedbackLabel = `Feedback or problems: ${FEEDBACK_EMAIL}`;
    const feedbackWidth = pdf.getTextWidth(feedbackLabel);
    const feedbackX = 105 - feedbackWidth / 2;
    pdf.textWithLink(feedbackLabel, feedbackX, 292, { url: FEEDBACK_URL });
    pdf.line(feedbackX, 293, feedbackX + feedbackWidth, 293);
  }
  return pdf;
}
export async function exportNotebookPdf(notebook: Notebook) {
  const arabic = hasArabic(
    [
      notebook.title,
      notebook.conversationTitle,
      notebook.overview?.summary ?? '',
      ...notebook.highlights.flatMap((h) => h.tags ?? []),
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
  await pdf.save(`${safeTitle}.pdf`, { returnPromise: true });
}
