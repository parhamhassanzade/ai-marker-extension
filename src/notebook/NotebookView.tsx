import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { Notebook, Database, HighlightColor } from '../types';
import { anchorSelection } from '../content/highlighter';
import { createToolbar } from '../content/toolbar';
import { storage } from '../storage/storage';
import { Message } from './Message';
import { chaptersOf } from './chapters';
export function NotebookView({
  notebook,
  busy,
  onChange,
  onAction,
}: {
  notebook: Notebook;
  busy: boolean;
  onChange(db: Database): void;
  onAction(fn: () => Promise<Database | void>): void;
}) {
  const [highlighterColor, setHighlighterColor] = useState<HighlightColor>();
  const colorRef = useRef(highlighterColor);
  colorRef.current = highlighterColor;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(notebook);
  latest.current = notebook;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [visible, setVisible] = useState(20);
  useEffect(() => {
    setVisible(20);
  }, [notebook.id]);
  useEffect(() => {
    const toolbar = createToolbar();
    let saving = false;
    const inspect = (event: PointerEvent | KeyboardEvent) => {
      if (
        event.composedPath().includes(toolbar.host) ||
        event
          .composedPath()
          .some(
            (node) => node instanceof HTMLElement && node.hasAttribute('data-highlight-controls'),
          )
      )
        return;
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) {
        toolbar.hide();
        return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      const element =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const root = element?.closest<HTMLElement>('[data-notebook-message-id]');
      if (!root || !container.current?.contains(root) || !root.contains(range.endContainer)) {
        toolbar.hide();
        return;
      }
      const anchored = anchorSelection(root, range);
      if (!anchored.text.trim() || anchored.text.length > 50000) return;
      const captured = latest.current;
      const messageId = root.dataset.notebookMessageId!;
      if (captured.messages.find((message) => message.id === messageId)?.role !== 'assistant') {
        toolbar.hide();
        return;
      }
      async function save(color: HighlightColor, note: string) {
        if (latest.current.id !== captured.id)
          throw new Error('The notebook changed. Select the passage again.');
        const current = latest.current;
        const db = await storage.saveHighlight(current.id, {
          id: uuid(),
          platform: current.platform,
          conversationId: current.conversationId,
          website: current.website,
          messageId,
          ...anchored,
          color,
          note,
          createdAt: new Date().toISOString(),
        });
        onChangeRef.current(db);
        selection?.removeAllRanges();
        return db;
      }
      const automaticColor = colorRef.current;
      if (automaticColor) {
        if (saving || busyRef.current) return;
        saving = true;
        actionRef.current(async () => {
          try {
            return await save(automaticColor, '');
          } finally {
            saving = false;
          }
        });
      } else
        toolbar.show(range.getBoundingClientRect(), {
          cancel: () => selection.removeAllRanges(),
          async save(color, note) {
            await save(color, note);
          },
        });
    };
    const pointer = (event: PointerEvent) => {
      if (!event.composedPath().includes(toolbar.host)) toolbar.hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Shift') inspect(event);
      if (event.key === 'Escape') toolbar.hide();
    };
    const hide = () => toolbar.hide();
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('pointerup', inspect);
    document.addEventListener('keyup', key);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      toolbar.destroy();
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('pointerup', inspect);
      document.removeEventListener('keyup', key);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [notebook.id]);
  const chapters = chaptersOf(notebook.messages);
  return (
    <div className="notebook-pages" ref={container}>
      <section
        className="highlighter-bar"
        data-highlight-controls
        onPointerDown={(event) => event.preventDefault()}
        aria-label="Sentence highlighter"
      >
        <div className="highlighter-heading">Sentence highlighter</div>
        <div className="highlighter-colors">
          {(['yellow', 'green', 'red'] as const).map((color) => (
            <button
              key={color}
              type="button"
              className={`highlighter-choice choice-${color}`}
              aria-label={`Use ${color} highlighter`}
              aria-pressed={highlighterColor === color}
              disabled={busy}
              onClick={() => setHighlighterColor(color)}
            >
              <span className="color-dot" />
              {color.charAt(0).toUpperCase() + color.slice(1)}
            </button>
          ))}
          <button
            type="button"
            className="highlighter-choice"
            aria-label="Use selection toolbar"
            aria-pressed={!highlighterColor}
            onClick={() => setHighlighterColor(undefined)}
          >
            Select text
          </button>
        </div>
        <p role="status">
          {highlighterColor
            ? `${highlighterColor.charAt(0).toUpperCase() + highlighterColor.slice(1)} highlighter is on. Drag over a sentence to highlight it.`
            : 'Choose a color, then drag over a sentence. Select text to add a note.'}
        </p>
      </section>
      {chapters.slice(0, visible).map((chapter) => (
        <article className="chapter" key={chapter.id}>
          <h2 className="chapter-heading">
            <span>CHAPTER {String(chapter.number).padStart(2, '0')}</span>
            <span className="chapter-rule" />
          </h2>
          {chapter.messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              highlights={notebook.highlights.filter((h) => h.messageId === message.id)}
              disabled={busy}
              onEdit={(id, note) => onAction(() => storage.updateNote(notebook.id, id, note))}
              onRemove={(id) => onAction(() => storage.removeHighlight(notebook.id, id))}
            />
          ))}
        </article>
      ))}
      {chapters.length > visible && (
        <button className="secondary-button load-more" onClick={() => setVisible(visible + 20)}>
          Read next 20 chapters ({chapters.length - visible} remaining)
        </button>
      )}
      {!chapters.length && (
        <div className="empty-state">
          Your notebook is ready. Ask a question in the chat to begin.
        </div>
      )}
    </div>
  );
}
