import { useState } from 'react';
import { MessageSquare, Trash2, Check } from 'lucide-react';
import type { Message as ConversationMessage, Highlight } from '../types';
import { HighlightText } from './Highlight';
const labels = { yellow: 'Highlight', green: 'Definition', red: 'Important' };
function Note({
  highlight,
  disabled,
  onEdit,
  onRemove,
}: {
  highlight: Highlight;
  disabled: boolean;
  onEdit(note: string): void;
  onRemove(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(highlight.note);
  return (
    <article className={`annotation annotation-${highlight.color}`}>
      <div className="annotation-header">
        <span className="category">
          <span className="dot" />
          {labels[highlight.color]}
        </span>
        <div className="flex gap-1">
          <button
            className="icon-button"
            disabled={disabled}
            aria-label="Edit note"
            onClick={() => {
              setNote(highlight.note);
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
      <blockquote>{highlight.text}</blockquote>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onEdit(note.trim());
            setEditing(false);
          }}
        >
          <textarea
            aria-label="Edit highlight note"
            value={note}
            maxLength={5000}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="text-button" disabled={disabled}>
            <Check size={13} />
            Save note
          </button>
        </form>
      ) : (
        highlight.note && (
          <p className="user-note">
            <span>YOUR NOTE</span>
            {highlight.note}
          </p>
        )
      )}
    </article>
  );
}
export function Message({
  message,
  highlights,
  disabled,
  onEdit,
  onRemove,
}: {
  message: ConversationMessage;
  highlights: Highlight[];
  disabled: boolean;
  onEdit(id: string, note: string): void;
  onRemove(id: string): void;
}) {
  return (
    <section className={`message message-${message.role}`}>
      <div className="message-label">
        {message.role === 'user' ? 'USER QUESTION' : 'AI ANSWER'}
        {message.timestamp && (
          <time dateTime={message.timestamp}>{new Date(message.timestamp).toLocaleString()}</time>
        )}
      </div>
      <div className="message-text" data-notebook-message-id={message.id}>
        <HighlightText text={message.text} highlights={highlights} />
      </div>
      {highlights.length > 0 && (
        <aside className="annotations">
          <h4>Highlighted notes</h4>
          {highlights.map((h) => (
            <Note
              key={h.id}
              highlight={h}
              disabled={disabled}
              onEdit={(note) => onEdit(h.id, note)}
              onRemove={() => onRemove(h.id)}
            />
          ))}
        </aside>
      )}
    </section>
  );
}
