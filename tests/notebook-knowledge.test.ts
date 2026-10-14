import { expect, it } from 'vitest';
import { emptyDatabase, transition } from '../src/storage/repository';
import { contentSignature, overviewOf } from '../src/knowledge/overview';
import type { ConversationSnapshot, Highlight } from '../src/types';
const snapshot: ConversationSnapshot = {
  platform: 'ChatGPT',
  conversationId: 'c',
  website: 'https://chatgpt.com/c/c',
  title: 'CAMUS dataset analysis',
  messages: [
    { id: 'q', role: 'user', text: 'What is CAMUS?' },
    {
      id: 'a',
      role: 'assistant',
      text: 'The CAMUS dataset is used for medical imaging and cardiac segmentation research.',
    },
  ],
};
const h: Highlight = {
  id: 'h',
  platform: 'ChatGPT',
  conversationId: 'c',
  website: snapshot.website,
  messageId: 'a',
  text: 'medical imaging',
  color: 'yellow',
  note: '',
  createdAt: '2026-10-14T00:00:00Z',
  anchor: { start: 30, end: 45, prefix: '', suffix: '' },
};
it('preserves highlight metadata and manual summaries through continued capture', () => {
  let db = transition(emptyDatabase(), { type: 'activate', snapshot });
  const id = db.notebooks[0]!.id;
  const start = snapshot.messages[1]!.text.indexOf(h.text);
  db = transition(db, {
    type: 'annotate',
    id,
    highlight: { ...h, anchor: { start, end: start + h.text.length, prefix: '', suffix: '' } },
  });
  db = transition(db, {
    type: 'updateAnnotation',
    id,
    highlightId: 'h',
    note: 'Useful for my thesis',
    tags: [' thesis ', 'thesis', 'segmentation'],
    bookmarked: true,
  });
  db = transition(db, {
    type: 'saveOverview',
    id,
    summary: 'A study of cardiac segmentation.',
    kind: 'manual',
    sourceSignature: contentSignature(snapshot.messages),
  });
  db = transition(db, {
    type: 'sync',
    snapshot: {
      ...snapshot,
      messages: [
        ...snapshot.messages,
        { id: 'a2', role: 'assistant', text: 'Additional details.' },
      ],
    },
  });
  expect(db.notebooks[0]!.highlights[0]).toMatchObject({
    note: 'Useful for my thesis',
    tags: ['thesis', 'segmentation'],
    bookmarked: true,
  });
  expect(db.notebooks[0]!.overview!.sourceSignature).toBe(
    contentSignature(db.notebooks[0]!.messages),
  );
  expect(overviewOf(db.notebooks[0]!).summary).toBe('A study of cardiac segmentation.');
  expect(overviewOf(db.notebooks[0]!).keyInsights[0]?.text).toBe('medical imaging');
});
it('loads legacy notebooks without generating a fake AI summary', () => {
  const notebook = transition(emptyDatabase(), { type: 'activate', snapshot }).notebooks[0]!;
  delete notebook.overview;
  const overview = overviewOf(notebook);
  expect(overview.summary).toBe('');
  expect(overview.topics.join(' ').toLowerCase()).toContain('camus');
  expect(overview.kind).toBe('local');
});
it('rejects a summary written against stale conversation content', () => {
  const db = transition(emptyDatabase(), { type: 'activate', snapshot });
  expect(() =>
    transition(db, {
      type: 'saveOverview',
      id: db.notebooks[0]!.id,
      summary: 'Old summary',
      kind: 'manual',
      sourceSignature: 'stale',
    }),
  ).toThrow('conversation changed');
});
