import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Star, Pencil, Check } from 'lucide-react';
import type { Notebook } from '../types';
import { overviewOf, contentSignature } from '../knowledge/overview';
import { chaptersOf, chapterTitle } from './chapters';
export function NotebookHome({
  notebook,
  disabled,
  onRead,
  onSaveSummary,
}: {
  notebook: Notebook;
  disabled: boolean;
  onRead(messageId: string): void;
  onSaveSummary(summary: string, signature: string): void;
}) {
  const overview = overviewOf(notebook);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(overview.summary);
  useEffect(() => {
    setEditing(false);
    setSummary(overview.summary);
  }, [notebook.id, overview.summary]);
  const chapters = chaptersOf(notebook.messages);
  return (
    <div className="notebook-home">
      <section className="summary-card">
        <div className="section-top">
          <h2>Your overview</h2>
          <button
            className="icon-button"
            aria-label="Edit notebook summary"
            onClick={() => {
              setSummary(overview.summary);
              setEditing(!editing);
            }}
          >
            <Pencil size={15} />
          </button>
        </div>
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSaveSummary(summary.trim(), contentSignature(notebook.messages));
              setEditing(false);
            }}
          >
            <textarea
              dir="auto"
              aria-label="Notebook summary"
              value={summary}
              maxLength={10000}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Paste a summary from your AI conversation or write your own."
            />
            <button className="text-button" disabled={disabled}>
              <Check size={14} />
              Save overview
            </button>
          </form>
        ) : overview.summary ? (
          <p className="summary-text" dir="auto">
            {overview.summary}
          </p>
        ) : (
          <p className="quiet-copy">
            A home for the ideas you want to keep. Add your own overview, or paste a summary from
            your AI conversation.
          </p>
        )}
        {!!overview.topics.length && (
          <div className="topics-block">
            <h3>Topics</h3>
            <div className="tag-list">
              {overview.topics.map((topic) => (
                <span className="topic-tag" dir="auto" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className="home-insights">
        <div className="section-top">
          <h2>
            <Star size={17} />
            Key insights
          </h2>
          <span className="quiet-label">From your highlights</span>
        </div>
        {overview.keyInsights.length ? (
          overview.keyInsights.map((insight, index) => (
            <button
              className="insight-preview"
              key={`${insight.messageId}-${index}`}
              onClick={() => onRead(insight.messageId)}
            >
              <span dir="auto">{insight.text}</span>
              <ArrowUpRight size={15} />
            </button>
          ))
        ) : (
          <div className="gentle-empty">
            <Star size={22} />
            <p>Keep the sentences that change how you think.</p>
            <span>
              Highlight a passage on ChatGPT or while reading here. Your favorite ideas will appear
              here.
            </span>
          </div>
        )}
      </section>
      <section>
        <div className="section-top">
          <h2>
            <BookOpen size={17} />
            Explore your notebook
          </h2>
          <span className="quiet-label">{chapters.length} chapters</span>
        </div>
        <div className="chapter-list">
          {chapters.map((chapter) => (
            <button className="chapter-link" key={chapter.id} onClick={() => onRead(chapter.id)}>
              <span className="chapter-index">{String(chapter.number).padStart(2, '0')}</span>
              <span className="chapter-link-title" dir="auto">
                {chapterTitle(chapter)}
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
