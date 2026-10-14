import { localOverview, contentSignature } from '../knowledge/overview';
import { v4 as uuid } from 'uuid';
import type { Command, ConversationSnapshot, Database, Notebook } from '../types';
import { resolveAnchor } from '../content/highlighter';
export const emptyDatabase = (): Database => ({
  version: 1,
  notebooks: [],
  activeByConversation: {},
  pausedConversations: [],
});
export const conversationKey = (s: Pick<ConversationSnapshot, 'platform' | 'conversationId'>) =>
  `${s.platform}:${s.conversationId}`;
function newNotebook(snapshot: ConversationSnapshot, title?: string): Notebook {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    conversationTitle: snapshot.title,
    title: title?.trim() || snapshot.title || 'Untitled notebook',
    platform: snapshot.platform,
    conversationId: snapshot.conversationId,
    website: snapshot.website,
    messages: structuredClone(snapshot.messages),
    highlights: [],
    overview: localOverview(snapshot.messages, title || snapshot.title),
    createdAt: now,
    updatedAt: now,
  };
}
// Pure transition function: a single serialized worker is the sole writer.
export function transition(db: Database, command: Command): Database {
  if (command.type === 'sourceHighlight') {
    const key = conversationKey(command.snapshot);
    const notebook =
      db.notebooks.find((n) => n.id === db.activeByConversation[key]) ??
      db.notebooks.filter((n) => conversationKey(n) === key).at(-1);
    // Annotation of a paused/finished notebook must not restart its capture.
    const base = structuredClone(db);
    if (notebook) base.activeByConversation[key] = notebook.id;
    const synced = transition(base, {
      type: notebook ? 'sync' : 'activate',
      snapshot: command.snapshot,
    });
    const id = synced.activeByConversation[key]!;
    if (notebook) {
      synced.activeByConversation = structuredClone(db.activeByConversation);
      synced.pausedConversations = [...db.pausedConversations];
    }
    return transition(synced, { type: 'annotate', id, highlight: command.highlight });
  }
  const next = structuredClone(db);
  if (command.type === 'list') return next;
  if ('snapshot' in command) {
    const s = command.snapshot;
    const key = conversationKey(s);
    if (command.type === 'sync' && command.previousConversationId) {
      const previousKey = conversationKey({ ...s, conversationId: command.previousConversationId });
      const oldId = next.activeByConversation[previousKey];
      const related = next.notebooks.filter((n) => conversationKey(n) === previousKey);
      // A temporary chat acquires a server URL only when the captured turns overlap.
      // Opening an unrelated saved chat must not migrate the temporary notebook.
      const sameTurns = related.some((n) =>
        n.messages.some((m) =>
          s.messages.some((incoming) => incoming.id === m.id && incoming.text === m.text),
        ),
      );
      if (command.previousConversationId.startsWith('temporary:') && sameTurns) {
        if (oldId && !next.activeByConversation[key]) {
          next.activeByConversation[key] = oldId;
          delete next.activeByConversation[previousKey];
        }
        for (const old of related) {
          old.conversationId = s.conversationId;
          old.website = s.website;
          old.highlights.forEach((h) => {
            h.conversationId = s.conversationId;
            h.website = s.website;
          });
        }
        if (next.pausedConversations.includes(previousKey))
          next.pausedConversations = next.pausedConversations
            .filter((k) => k !== previousKey)
            .concat(key);
      }
    }
    let notebook = next.notebooks.find((n) => n.id === next.activeByConversation[key]);
    if (command.type === 'create') {
      if (notebook) notebook.finishedAt = new Date().toISOString();
      notebook = newNotebook(s, command.title);
      next.notebooks.push(notebook);
      next.activeByConversation[key] = notebook.id;
    } else if (command.type === 'activate') {
      notebook ??= [...next.notebooks]
        .reverse()
        .find((n) => conversationKey(n) === key && !n.finishedAt);
      if (!notebook) {
        notebook = newNotebook(s);
        next.notebooks.push(notebook);
      }
      next.activeByConversation[key] = notebook.id;
    } else if (!notebook) {
      // Visiting a chat alone never captures it: Notebook Mode is explicit opt-in.
      return next;
    }
    next.pausedConversations = next.pausedConversations.filter((k) => k !== key);
    // Insert newly discovered older turns before the next known turn. A virtualized
    // page may expose earlier history after the most recent messages were captured.
    for (let i = 0; i < s.messages.length; i++) {
      const message = s.messages[i]!;
      const index = notebook.messages.findIndex((m) => m.id === message.id);
      if (index >= 0) notebook.messages[index] = structuredClone(message);
      else {
        const following = s.messages
          .slice(i + 1)
          .find((m) => notebook.messages.some((old) => old.id === m.id));
        const insertAt = following
          ? notebook.messages.findIndex((m) => m.id === following.id)
          : notebook.messages.length;
        notebook.messages.splice(insertAt, 0, structuredClone(message));
      }
    }
    if (notebook.messages.every((m) => m.order !== undefined))
      notebook.messages.sort((a, b) => a.order! - b.order!);
    notebook.conversationTitle = s.title;
    notebook.website = s.website;
    if (notebook.overview?.sourceSignature !== contentSignature(notebook.messages)) {
      const previousOverview = notebook.overview;
      notebook.overview = localOverview(notebook.messages, notebook.title);
      if (previousOverview?.kind === 'manual')
        notebook.overview = {
          ...notebook.overview,
          summary: previousOverview.summary,
          kind: 'manual',
          generatedAt: previousOverview.generatedAt,
        };
    }
    const before = db.notebooks.find((n) => n.id === notebook.id);
    if (JSON.stringify(before) !== JSON.stringify(notebook))
      notebook.updatedAt = new Date().toISOString();
  } else {
    const notebook = next.notebooks.find((n) => n.id === command.id);
    if (!notebook) throw new Error('Notebook no longer exists.');
    if (command.type === 'finish' || command.type === 'pause') {
      if (command.type === 'finish') notebook.finishedAt = new Date().toISOString();
      const key = conversationKey(notebook);
      if (next.activeByConversation[key] === notebook.id) {
        delete next.activeByConversation[key];
        next.pausedConversations.push(key);
      }
    }
    if (command.type === 'annotate') {
      const h = command.highlight;
      const message = notebook.messages.find((m) => m.id === h.messageId);
      if (
        !message ||
        h.conversationId !== notebook.conversationId ||
        h.platform !== notebook.platform ||
        resolveAnchor(message.text, h) === undefined
      )
        throw new Error('The selected passage changed. Select it again.');
      if (!notebook.highlights.some((old) => old.id === h.id))
        notebook.highlights.push(structuredClone(h));
    }
    if (command.type === 'updateNote') {
      const h = notebook.highlights.find((h) => h.id === command.highlightId);
      if (!h) throw new Error('This highlight no longer exists.');
      h.note = command.note;
    }
    if (command.type === 'updateAnnotation') {
      const h = notebook.highlights.find((h) => h.id === command.highlightId);
      if (!h) throw new Error('This highlight no longer exists.');
      h.note = command.note;
      h.tags = [...new Set(command.tags.map((tag) => tag.trim()).filter(Boolean))];
      h.bookmarked = command.bookmarked;
    }
    if (command.type === 'saveOverview') {
      if (command.sourceSignature !== contentSignature(notebook.messages))
        throw new Error('Your conversation changed. Generate the summary again.');
      const overview = localOverview(notebook.messages, notebook.title);
      notebook.overview = { ...overview, summary: command.summary.trim(), kind: command.kind };
    }
    if (command.type === 'clear') notebook.highlights = [];
    if (command.type === 'removeHighlight')
      notebook.highlights = notebook.highlights.filter((h) => h.id !== command.highlightId);
    if (command.type === 'rename') {
      if (!command.title.trim()) throw new Error('Enter a notebook title.');
      notebook.title = command.title.trim().slice(0, 200);
    }
    notebook.updatedAt = new Date().toISOString();
  }
  return next;
}
