import { it, expect } from 'vitest';
import { createNotebookPdf } from '../src/pdf/notebookExporter';
import type { Notebook } from '../src/types';
import { DONATION_URL, FEEDBACK_URL } from '../src/config';
it('paginates very long answers and retains notes and page numbers', () => {
  const notebook: Notebook = {
    id: 'n',
    title: 'Research',
    conversationTitle: 'Research conversation',
    platform: 'ChatGPT',
    conversationId: 'c',
    website: 'https://chatgpt.com/c/c',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    messages: [
      { id: 'q', role: 'user', text: 'Explain.' },
      { id: 'a', role: 'assistant', text: 'An important explanation with details. '.repeat(2000) },
    ],
    highlights: [
      {
        id: 'h',
        platform: 'ChatGPT',
        conversationId: 'c',
        messageId: 'a',
        text: 'important explanation',
        color: 'red',
        note: 'Remember this insight',
        createdAt: '2026-01-01T00:00:00Z',
        website: '',
        anchor: { start: 3, end: 24, prefix: '', suffix: '' },
      },
    ],
  };
  const pdf = createNotebookPdf(notebook);
  expect(pdf.getNumberOfPages()).toBeGreaterThan(10);
  expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  // URI annotations remain visible outside compressed content streams. Exactly
  // one donation annotation per page verifies the actual clickable PDF output.
  const donationLinks = pdf.output().split(`/URI (${DONATION_URL})`).length - 1;
  expect(donationLinks).toBe(pdf.getNumberOfPages());
  expect(pdf.output().split(`/URI (${FEEDBACK_URL})`).length - 1).toBe(pdf.getNumberOfPages());
});

it('rejects empty notebooks so metadata-only output cannot be downloaded', () => {
  const empty = { title: 'Empty', messages: [], highlights: [] } as unknown as Notebook;
  expect(() => createNotebookPdf(empty)).toThrow(/no conversation messages/);
});
