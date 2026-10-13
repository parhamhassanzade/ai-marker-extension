import { expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { visualRuns, isRtlParagraph } from '../src/pdf/bidirectional';
import { createNotebookPdf } from '../src/pdf/notebookExporter';
import type { Notebook } from '../src/types';
const latin = readFileSync('public/fonts/NotoSans-Regular.ttf').toString('base64');
const arabic = readFileSync('public/fonts/NotoNaskhArabic-Regular.ttf').toString('base64');
it('joins Persian letters while retaining Latin words and highlight identity in visual order', () => {
  const pdf = new jsPDF();
  const runs = visualRuns(
    pdf,
    [{ text: 'سلام ', color: 'yellow' }, { text: 'Machine Learning' }, { text: ' می‌توانیم ۲۰۲۶' }],
    true,
    () => 'NotoNaskhArabic',
  );
  const visual = runs.map((run) => run.text).join('');
  expect(visual).toContain('Machine Learning');
  expect(visual).toContain('۲۰۲۶');
  expect(visual).not.toContain('\u200c');
  const highlighted = runs
    .filter((run) => run.color)
    .map((run) => run.text)
    .join('')
    .normalize('NFKC');
  expect(highlighted).toBe(' ملاس');
  expect(isRtlParagraph('یادگیری ماشین (AI)')).toBe(true);
  expect(isRtlParagraph('Machine Learning یعنی یادگیری ماشین')).toBe(false);
});
it('exports a paginated Persian notebook with mixed text, Persian notes and all highlight colors', () => {
  const notebook = JSON.parse(
    readFileSync('tests/fixtures/persian-notebook.json', 'utf8'),
  ) as Notebook;
  const pdf = createNotebookPdf(notebook, latin, arabic);
  expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
  const fonts = pdf.getFontList();
  expect(fonts.NotoNaskhArabic).toBeDefined();
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/persian-notebook.pdf', Buffer.from(pdf.output('arraybuffer')));
});
