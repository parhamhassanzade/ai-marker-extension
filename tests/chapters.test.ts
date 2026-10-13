import { it, expect } from 'vitest';
import { chaptersOf } from '../src/notebook/chapters';
it('groups all questions and full answers into sequential chapters', () => {
  const chapters = chaptersOf([
    { id: 'q1', role: 'user', text: 'One' },
    { id: 'a1', role: 'assistant', text: 'Answer one' },
    { id: 'a1b', role: 'assistant', text: 'Continuation' },
    { id: 'q2', role: 'user', text: 'Two' },
    { id: 'a2', role: 'assistant', text: 'Answer two' },
  ]);
  expect(chapters).toHaveLength(2);
  expect(chapters[0]?.messages.map((m) => m.id)).toEqual(['q1', 'a1', 'a1b']);
  expect(chapters[1]?.number).toBe(2);
});
it('retains assistant-only openings', () => {
  expect(chaptersOf([{ id: 'a', role: 'assistant', text: 'Welcome' }])[0]?.messages).toHaveLength(
    1,
  );
});
