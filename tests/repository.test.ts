import { describe, it, expect } from 'vitest';
import { emptyDatabase, transition, conversationKey } from '../src/storage/repository';
import type { ConversationSnapshot, Highlight } from '../src/types';
const snapshot: ConversationSnapshot = {
  platform: 'ChatGPT',
  conversationId: 'chat-1',
  website: 'https://chatgpt.com/c/chat-1',
  title: 'Learning',
  messages: [
    { id: 'q1', role: 'user', text: 'Explain learning' },
    { id: 'a1', role: 'assistant', text: 'Weights change.' },
  ],
};
const highlight: Highlight = {
  id: 'h1',
  platform: 'ChatGPT',
  conversationId: 'chat-1',
  messageId: 'a1',
  website: snapshot.website,
  text: 'Weights',
  color: 'yellow',
  note: 'Definition',
  createdAt: new Date().toISOString(),
  anchor: { start: 0, end: 7, prefix: '', suffix: ' change.' },
};
const activated = () => transition(emptyDatabase(), { type: 'activate', snapshot });
describe('explicit notebook lifecycle', () => {
  it('creates a notebook atomically on the first source highlight', () => {
    const db = transition(emptyDatabase(), { type: 'sourceHighlight', snapshot, highlight });
    expect(db.notebooks).toHaveLength(1);
    expect(db.notebooks[0]?.highlights).toEqual([highlight]);
    expect(db.activeByConversation[conversationKey(snapshot)]).toBe(db.notebooks[0]?.id);
  });
  it('annotates the finished source notebook without restarting capture', () => {
    let db = activated();
    const id = db.notebooks[0]!.id;
    db = transition(db, { type: 'finish', id });
    const finishedAt = db.notebooks[0]!.finishedAt;
    db = transition(db, { type: 'sourceHighlight', snapshot, highlight });
    expect(db.notebooks).toHaveLength(1);
    expect(db.notebooks[0]?.highlights).toEqual([highlight]);
    expect(db.notebooks[0]?.finishedAt).toBe(finishedAt);
    expect(db.activeByConversation).toEqual({});
    expect(db.pausedConversations).toContain(conversationKey(snapshot));
  });
  it('does not capture an unactivated conversation', () => {
    expect(transition(emptyDatabase(), { type: 'sync', snapshot }).notebooks).toHaveLength(0);
  });
  it('collects full turns idempotently after activation', () => {
    let db = activated();
    const id = db.notebooks[0]!.id;
    db = transition(db, { type: 'annotate', id, highlight });
    db = transition(db, { type: 'annotate', id, highlight });
    db = transition(db, {
      type: 'sync',
      snapshot: {
        ...snapshot,
        messages: [
          { id: 'q2', role: 'user', text: 'More?' },
          { id: 'a2', role: 'assistant', text: 'More detail.' },
        ],
      },
    });
    expect(db.notebooks[0]?.highlights).toHaveLength(1);
    expect(db.notebooks[0]?.messages).toHaveLength(4);
  });
  it('pauses capture, resumes the same notebook, and finishing starts a fresh notebook on activation', () => {
    let db = activated();
    const id = db.notebooks[0]!.id;
    db = transition(db, { type: 'pause', id });
    db = transition(db, {
      type: 'sync',
      snapshot: {
        ...snapshot,
        messages: [{ id: 'new', role: 'assistant', text: 'Not captured.' }],
      },
    });
    expect(db.notebooks[0]?.messages).toHaveLength(2);
    db = transition(db, { type: 'activate', snapshot });
    expect(db.activeByConversation[conversationKey(snapshot)]).toBe(id);
    db = transition(db, { type: 'finish', id });
    db = transition(db, { type: 'sync', snapshot });
    expect(db.notebooks).toHaveLength(1);
    db = transition(db, { type: 'activate', snapshot });
    expect(db.notebooks).toHaveLength(2);
    expect(db.activeByConversation[conversationKey(snapshot)]).not.toBe(id);
  });
  it('isolates conversations and preserves earlier notebooks on manual creation', () => {
    let db = activated();
    db = transition(db, { type: 'annotate', id: db.notebooks[0]!.id, highlight });
    db = transition(db, { type: 'activate', snapshot: { ...snapshot, conversationId: 'chat-2' } });
    db = transition(db, { type: 'create', snapshot });
    expect(db.notebooks).toHaveLength(3);
    expect(db.notebooks[0]?.finishedAt).toBeTruthy();
    expect(db.notebooks[0]?.highlights).toHaveLength(1);
  });
  it('migrates a temporary URL and every attached annotation', () => {
    const temp = { ...snapshot, conversationId: 'temporary:123' };
    let db = transition(emptyDatabase(), { type: 'activate', snapshot: temp });
    db = transition(db, {
      type: 'annotate',
      id: db.notebooks[0]!.id,
      highlight: { ...highlight, conversationId: temp.conversationId },
    });
    db = transition(db, { type: 'sync', snapshot, previousConversationId: temp.conversationId });
    expect(db.notebooks).toHaveLength(1);
    expect(db.notebooks[0]?.highlights[0]?.conversationId).toBe('chat-1');
  });
  it('inserts newly rendered older turns in conversation order', () => {
    let db = transition(emptyDatabase(), {
      type: 'activate',
      snapshot: {
        ...snapshot,
        messages: [
          { id: 'q2', role: 'user', text: 'Second' },
          { id: 'a2', role: 'assistant', text: 'Second answer' },
        ],
      },
    });
    db = transition(db, {
      type: 'sync',
      snapshot: {
        ...snapshot,
        messages: [...snapshot.messages, { id: 'q2', role: 'user', text: 'Second' }],
      },
    });
    expect(db.notebooks[0]?.messages.map((m) => m.id)).toEqual(['q1', 'a1', 'q2', 'a2']);
  });
  it('edits and clears notes without erasing conversation text or mutating the input', () => {
    let db = activated();
    const id = db.notebooks[0]!.id;
    db = transition(db, { type: 'annotate', id, highlight });
    const next = transition(db, { type: 'updateNote', id, highlightId: 'h1', note: 'Edited' });
    expect(next.notebooks[0]?.highlights[0]?.note).toBe('Edited');
    expect(db.notebooks[0]?.highlights[0]?.note).toBe('Definition');
    const cleared = transition(next, { type: 'clear', id });
    expect(cleared.notebooks[0]?.highlights).toHaveLength(0);
    expect(cleared.notebooks[0]?.messages).toHaveLength(2);
  });
  it('avoids notification loops for identical snapshots', () => {
    const db = activated();
    expect(transition(db, { type: 'sync', snapshot })).toEqual(db);
  });
});
