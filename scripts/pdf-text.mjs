import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
export const normalizeText = (text) => text.replace(/\s+/g, ' ').trim();
export async function readPdfText(file) {
  const pdf = await getDocument({
    data: new Uint8Array(await readFile(file)),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return { text: normalizeText(pages.join('\n')), pages: pdf.numPages };
  } finally {
    await pdf.destroy();
  }
}
