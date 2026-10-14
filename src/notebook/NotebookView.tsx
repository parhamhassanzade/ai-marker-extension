import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { BookOpen, Home, Star, Search, Bookmark } from 'lucide-react';
import { AnnotationCard } from './AnnotationCard';
import { NotebookHome } from './NotebookHome';
import type { Notebook, Database, HighlightColor } from '../types';
import { anchorSelection } from '../content/highlighter';
import { createToolbar } from '../content/toolbar';
import { storage } from '../storage/storage';
import { Message } from './Message';
import { chaptersOf, chapterTitle } from './chapters';
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
  const [view, setView] = useState<'home' | 'read' | 'highlights'>('home');
  const [activeChapter, setActiveChapter] = useState('');
  const [query, setQuery] = useState('');
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [tag, setTag] = useState('');
  const [highlightLimit, setHighlightLimit] = useState(100);
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
    setView('home');
    setActiveChapter('');
    setQuery('');
    setTag('');
    setBookmarksOnly(false);
    setHighlightLimit(100);
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
  }, [notebook.id, view]);
  const chapters = chaptersOf(notebook.messages);
  function jump(messageId: string) {
    const index = chapters.findIndex((chapter) =>
      chapter.messages.some((message) => message.id === messageId),
    );
    if (index < 0) return;
    setVisible((count) => Math.max(count, Math.ceil((index + 1) / 20) * 20));
    setActiveChapter(chapters[index]!.id);
    setView('read');
  }
  useEffect(() => {
    if (view === 'read' && activeChapter) {
      const frame = requestAnimationFrame(() =>
        document.getElementById(`chapter-${activeChapter}`)?.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start',
        }),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [activeChapter, view, visible]);
  const tags = [...new Set(notebook.highlights.flatMap((h) => h.tags ?? []))].sort();
  const filtered = notebook.highlights.filter(
    (h) =>
      (!bookmarksOnly || h.bookmarked) &&
      (!tag || h.tags?.includes(tag)) &&
      `${h.text} ${h.note} ${(h.tags ?? []).join(' ')}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const update = (id: string, value: { note: string; tags?: string[]; bookmarked?: boolean }) =>
    onAction(() =>
      storage.updateAnnotation(notebook.id, id, value.note, value.tags ?? [], !!value.bookmarked),
    );
  return (
    <div className="notebook-pages" ref={container}>
      <nav className="notebook-tabs" aria-label="Notebook sections">
        <button aria-current={view === 'home' ? 'page' : undefined} onClick={() => setView('home')}>
          <Home size={15} />
          Home
        </button>
        <button aria-current={view === 'read' ? 'page' : undefined} onClick={() => setView('read')}>
          <BookOpen size={15} />
          Read
        </button>
        <button
          aria-current={view === 'highlights' ? 'page' : undefined}
          onClick={() => setView('highlights')}
        >
          <Star size={15} />
          Highlights<span className="tab-count">{notebook.highlights.length}</span>
        </button>
      </nav>
      <section hidden={view !== 'home'} aria-label="Notebook home">
        <NotebookHome
          notebook={notebook}
          disabled={busy}
          onRead={jump}
          onSaveSummary={(summary, signature) =>
            onAction(() => storage.saveOverview(notebook.id, summary, 'manual', signature))
          }
        />
      </section>
      <section
        hidden={view !== 'highlights'}
        aria-label="Your highlights"
        className="highlight-library"
      >
        <div className="section-top">
          <h2>Your highlights</h2>
          <span className="quiet-label">
            {filtered.length} saved {filtered.length === 1 ? 'idea' : 'ideas'}
          </span>
        </div>
        <label className="highlight-search">
          <Search size={15} />
          <input
            aria-label="Search highlights"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an idea, note, or tag…"
          />
        </label>
        <div className="highlight-filters">
          <button
            className={`filter-button ${bookmarksOnly ? 'selected' : ''}`}
            aria-pressed={bookmarksOnly}
            onClick={() => setBookmarksOnly(!bookmarksOnly)}
          >
            <Bookmark size={14} />
            Bookmarked
          </button>
          {tags.length > 0 && (
            <select
              aria-label="Filter by tag"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            >
              <option value="">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
        </div>
        {filtered.slice(0, highlightLimit).map((highlight) => (
          <AnnotationCard
            key={highlight.id}
            highlight={highlight}
            disabled={busy}
            onUpdate={(value) => update(highlight.id, value)}
            onRemove={() => onAction(() => storage.removeHighlight(notebook.id, highlight.id))}
            onJump={() => jump(highlight.messageId)}
          />
        ))}
        {!filtered.length && (
          <div className="gentle-empty">
            <Star size={26} />
            <p>
              {notebook.highlights.length
                ? 'No highlights match your search.'
                : 'Your best ideas belong here.'}
            </p>
            <span>
              {notebook.highlights.length
                ? 'Try another word or remove a filter.'
                : 'Select a sentence on ChatGPT or in the reading view to start collecting.'}
            </span>
          </div>
        )}
        {filtered.length > highlightLimit && (
          <button
            className="secondary-button"
            onClick={() => setHighlightLimit(highlightLimit + 100)}
          >
            Show more highlights
          </button>
        )}
      </section>
      <section hidden={view !== 'read'} aria-label="Reading view">
        {!!chapters.length && (
          <div className="chapter-navigation">
            <label htmlFor="chapter-jump">Browse chapters</label>
            <select
              id="chapter-jump"
              aria-label="Jump to chapter"
              value={activeChapter || chapters[0]?.id}
              onChange={(event) => jump(event.target.value)}
            >
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {String(chapter.number).padStart(2, '0')} · {chapterTitle(chapter)}
                </option>
              ))}
            </select>
          </div>
        )}
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
          <article className="chapter" key={chapter.id} id={`chapter-${chapter.id}`}>
            <h2 className="chapter-heading" dir="auto">
              <span className="chapter-index">{String(chapter.number).padStart(2, '0')}</span>
              {chapterTitle(chapter)}
            </h2>
            {chapter.messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                highlights={notebook.highlights.filter((h) => h.messageId === message.id)}
                disabled={busy}
                onUpdate={update}
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
      </section>
    </div>
  );
}
