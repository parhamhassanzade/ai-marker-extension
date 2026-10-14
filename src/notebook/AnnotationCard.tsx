import { useState } from 'react';
import { Bookmark, MessageSquare, Trash2, Check, ArrowUpRight } from 'lucide-react';
import type { Highlight } from '../types';
export type AnnotationUpdate = Pick<Highlight, 'note' | 'tags' | 'bookmarked'>;
const labels = { yellow: 'Highlight', green: 'Definition', red: 'Important' };
export function AnnotationCard({
  highlight,
  disabled,
  onUpdate,
  onRemove,
  onJump,
}: {
  highlight: Highlight;
  disabled: boolean;
  onUpdate(value: AnnotationUpdate): void;
  onRemove(): void;
  onJump?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(highlight.note);
  const [tags, setTags] = useState((highlight.tags ?? []).join(', '));
  return (
    <article
      className={`annotation annotation-${highlight.color}`}
      data-annotation-id={highlight.id}
    >
      <div className="annotation-header">
        <span className="category">
          <span className="dot" />
          {labels[highlight.color]}
        </span>
        <div className="annotation-tools">
          {onJump && (
            <button className="icon-button" aria-label="Go to passage" onClick={onJump}>
              <ArrowUpRight size={14} />
            </button>
          )}
          <button
            className="icon-button"
            disabled={disabled}
            aria-label={highlight.bookmarked ? 'Remove bookmark' : 'Bookmark highlight'}
            aria-pressed={!!highlight.bookmarked}
            onClick={() =>
              onUpdate({
                note: highlight.note,
                tags: highlight.tags ?? [],
                bookmarked: !highlight.bookmarked,
              })
            }
          >
            <Bookmark size={14} fill={highlight.bookmarked ? 'currentColor' : 'none'} />
          </button>
          <button
            className="icon-button"
            disabled={disabled}
            aria-label="Edit note"
            onClick={() => {
              setNote(highlight.note);
              setTags((highlight.tags ?? []).join(', '));
              setEditing(!editing);
            }}
          >
            <MessageSquare size={14} />
          </button>
          <button
            className="icon-button"
            disabled={disabled}
            aria-label="Delete highlight"
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <blockquote dir="auto">{highlight.text}</blockquote>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onUpdate({
              note: note.trim(),
              tags: [
                ...new Set(
                  tags
                    .split(',')
                    .map((tag) => tag.trim().slice(0, 50))
                    .filter(Boolean),
                ),
              ].slice(0, 20),
              bookmarked: !!highlight.bookmarked,
            });
            setEditing(false);
          }}
        >
          <label className="field-label">
            Your note
            <textarea
              aria-label="Edit highlight note"
              dir="auto"
              maxLength={5000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why does this idea matter to you?"
            />
          </label>
          <label className="field-label">
            Tags
            <input
              aria-label="Highlight tags"
              value={tags}
              maxLength={1000}
              onChange={(event) => setTags(event.target.value)}
              placeholder="e.g. thesis, definitions, exam"
            />
          </label>
          <button className="text-button" disabled={disabled}>
            <Check size={13} />
            Save note
          </button>
        </form>
      ) : (
        <>
          {highlight.note && (
            <p className="user-note" dir="auto">
              <span>Your note</span>
              {highlight.note}
            </p>
          )}
          {!!highlight.tags?.length && (
            <div className="tag-list">
              {highlight.tags.map((tag) => (
                <span className="topic-tag" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}
