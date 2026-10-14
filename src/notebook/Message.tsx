import { MessageCircle, Sparkles, Star } from 'lucide-react';
import type { Message as ConversationMessage, Highlight } from '../types';
import { HighlightText } from './Highlight';
import { AnnotationCard, type AnnotationUpdate } from './AnnotationCard';
export function Message({
  message,
  highlights,
  disabled,
  onUpdate,
  onRemove,
}: {
  message: ConversationMessage;
  highlights: Highlight[];
  disabled: boolean;
  onUpdate(id: string, value: AnnotationUpdate): void;
  onRemove(id: string): void;
}) {
  const user = message.role === 'user';
  return (
    <section className={`message message-${message.role}`}>
      <div className="message-label">
        {user ? <MessageCircle size={15} /> : <Sparkles size={15} />}{' '}
        {user ? 'Your question' : 'AI response'}
        {message.timestamp && (
          <time dateTime={message.timestamp}>
            {new Date(message.timestamp).toLocaleDateString()}
          </time>
        )}
      </div>
      <div className="message-text" dir="auto" data-notebook-message-id={message.id}>
        <HighlightText text={message.text} highlights={highlights} />
      </div>
      {!!highlights.length && (
        <aside className="annotations">
          <h4>
            <Star size={14} />
            Highlights
          </h4>
          {highlights.map((highlight) => (
            <AnnotationCard
              key={highlight.id}
              highlight={highlight}
              disabled={disabled}
              onUpdate={(value) => onUpdate(highlight.id, value)}
              onRemove={() => onRemove(highlight.id)}
            />
          ))}
        </aside>
      )}
    </section>
  );
}
