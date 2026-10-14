import { openNotebookWindow } from '../browser/notebookWindow';
import { extension, isExtensionContext } from '../browser/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Download,
  Plus,
  Check,
  Moon,
  Sun,
  ArrowUpRight,
  RefreshCw,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import type { ConversationSnapshot, Database, Notebook } from '../types';
import { storage } from '../storage/storage';
import { settings } from '../storage/settings';
import { conversationKey } from '../storage/repository';
import { chaptersOf } from './chapters';
import {
  currentConversation,
  currentSourceTab,
  conversationFromTab,
  waitForLoadedMessages,
  ensureContentScript,
} from './connection';
import { NotebookView } from './NotebookView';
export default function App() {
  const isToolbarPopup =
    isExtensionContext() &&
    !!extension.runtime.getManifest().action?.default_popup &&
    !new URLSearchParams(location.search).has('sourceWindow');
  const [db, setDb] = useState<Database>();
  const [context, setContext] = useState<ConversationSnapshot>();
  const [selected, setSelected] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clear, setClear] = useState(false);
  const [captureNotice, setCaptureNotice] = useState('');
  const [scanning, setScanning] = useState(false);
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const tabId = useRef<number | undefined>(undefined);
  const contextRequest = useRef(0);
  const load = useCallback(async () => {
    try {
      setDb(await storage.listNotebooks());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notebooks.');
    } finally {
      setLoading(false);
    }
  }, []);
  const refreshContext = useCallback(async () => {
    const request = ++contextRequest.current;
    try {
      const { tabId: id, snapshot } = await currentConversation();
      if (request !== contextRequest.current) return;
      tabId.current = id;
      setContext(snapshot?.platform ? snapshot : undefined);
      setConnectionError('');
    } catch (failure) {
      if (request === contextRequest.current) {
        setContext(undefined);
        tabId.current = undefined;
        setConnectionError(
          failure instanceof Error
            ? failure.message
            : 'Unable to access this tab. Retry the connection.',
        );
      }
    }
  }, []);
  useEffect(() => {
    if (!isExtensionContext()) {
      setLoading(false);
      setError('Install AI Notebook in your browser to open your notebook.');
      return;
    }
    void load();
    void refreshContext();
    const unsubscribe = storage.subscribe(() => {
      void load();
      void refreshContext();
    });
    const activated = () => {
      setSelected('');
      void refreshContext();
    };
    const updated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId.current && (info.url || info.status === 'complete')) {
        setSelected('');
        void refreshContext();
      }
    };
    const captureError = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (
        sender.id === extension.runtime.id &&
        sender.tab?.id === tabId.current &&
        typeof message === 'object' &&
        message &&
        'type' in message &&
        message.type === 'captureError' &&
        'error' in message
      )
        setError(String(message.error));
      return false;
    };
    extension.runtime.onMessage.addListener(captureError);
    extension.tabs.onActivated.addListener(activated);
    extension.tabs.onUpdated.addListener(updated);
    const poll = setInterval(() => {
      void refreshContext();
    }, 1500);
    return () => {
      unsubscribe();
      extension.runtime.onMessage.removeListener(captureError);
      clearInterval(poll);
      extension.tabs.onActivated.removeListener(activated);
      extension.tabs.onUpdated.removeListener(updated);
    };
  }, [load, refreshContext]);
  useEffect(() => {
    void settings
      .getTheme()
      .then((theme) => {
        if (theme) setDark(theme === 'dark');
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  const key = context && conversationKey(context);
  const currentId = key ? db?.activeByConversation[key] : undefined;
  const notebook: Notebook | undefined =
    db?.notebooks.find((n) => n.id === (selected || currentId)) ??
    (key ? db?.notebooks.filter((n) => conversationKey(n) === key).at(-1) : db?.notebooks.at(-1));
  const collecting =
    !!notebook && db?.activeByConversation[conversationKey(notebook)] === notebook.id;
  useEffect(() => {
    setTitle(notebook?.title ?? '');
    setClear(false);
  }, [notebook?.id, notebook?.title]);
  async function act(fn: () => Promise<Database | void>) {
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      if (result) setDb(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  }
  async function refreshCurrentConversation() {
    if (!tabId.current) return;
    await ensureContentScript(tabId.current);
    const result = await extension.tabs.sendMessage<
      { type: string },
      { ok: boolean; error?: string }
    >(tabId.current, { type: 'refreshConversation' });
    if (!result?.ok) throw new Error(result?.error || 'Could not refresh the conversation.');
  }
  async function activate() {
    const { tabId: id, snapshot: detected } = await currentConversation();
    tabId.current = id;
    const snapshot = /\/c\/[^/]+/.test(new URL(detected.website).pathname)
      ? await waitForLoadedMessages(id)
      : detected;
    setContext(snapshot);
    const result = await storage.activateNotebook(snapshot);
    setSelected(result.activeByConversation[conversationKey(snapshot)] ?? '');
    if (tabId.current) {
      setScanning(true);
      try {
        const capture = await extension.tabs.sendMessage<
          { type: string },
          { ok: boolean; complete?: boolean; error?: string }
        >(tabId.current, { type: 'captureHistory' });
        if (!capture.ok)
          throw new Error(capture.error || 'Could not capture conversation history.');
        setCaptureNotice(
          capture.complete
            ? `ChatGPT conversation detected: ${(await storage.listNotebooks()).notebooks.find((n) => n.id === result.activeByConversation[conversationKey(snapshot)])?.messages.length ?? snapshot.messages.length} messages imported.`
            : 'Capture stopped before reaching the start. You can activate again or scroll through older turns to continue capture.',
        );
      } finally {
        setScanning(false);
      }
    }
    return storage.listNotebooks();
  }
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <BookOpen size={19} />
          </span>
          AI Notebook
        </div>
        <button
          className="icon-button"
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => {
            const next = !dark;
            setDark(next);
            void settings.setTheme(next ? 'dark' : 'light').catch(() => undefined);
          }}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>
      {isToolbarPopup && (
        <button
          className="keep-open-button"
          disabled={busy || !context}
          onClick={() => {
            void act(async () => {
              await openNotebookWindow(await currentSourceTab());
            });
          }}
        >
          <ArrowUpRight size={16} /> Keep notebook open
        </button>
      )}
      <section
        className={`${notebook ? 'capture-strip' : 'mode-card'} ${currentId ? 'mode-card-active' : ''}`}
      >
        <div className="mode-copy">
          <span className="eyebrow">YOUR PERSONAL STUDY SPACE</span>
          <h1>
            {currentId ? (
              'Your notebook is growing.'
            ) : (
              <>
                Turn a conversation
                <br />
                into something you keep.
              </>
            )}
          </h1>
          <p>{context ? context.title : 'Open a ChatGPT conversation to get started.'}</p>
        </div>
        <button
          className={`mode-button ${currentId ? 'active' : ''}`}
          disabled={!context || busy}
          onClick={() => {
            if (currentId) void act(() => storage.pauseNotebook(currentId));
            else void act(activate);
          }}
        >
          {currentId ? <Pause size={15} /> : <Play size={15} />}{' '}
          {scanning
            ? 'Capturing conversation…'
            : busy
              ? 'Working…'
              : currentId
                ? 'Pause updates'
                : notebook &&
                    !notebook.finishedAt &&
                    context &&
                    conversationKey(notebook) === conversationKey(context)
                  ? 'Resume updates'
                  : 'Create notebook'}
        </button>
        <p className="mode-hint">
          {currentId
            ? 'New replies are added as your conversation grows.'
            : 'Create a notebook to save this conversation and collect its best ideas.'}
        </p>
      </section>
      {connectionError && (
        <div className="connection-notice" role="status">
          {connectionError}
          <button
            className="text-button"
            onClick={() => {
              void refreshContext();
            }}
          >
            Retry connection
          </button>
        </div>
      )}
      {captureNotice && (
        <p className="capture-notice" role="status">
          {captureNotice}
        </p>
      )}
      {scanning && (
        <button
          className="text-button"
          onClick={() => {
            if (tabId.current)
              void extension.tabs.sendMessage(tabId.current, { type: 'cancelHistory' });
          }}
        >
          Stop history scan
        </button>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              setError('');
              void load();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div role="status" className="empty-state">
          Opening your notebook library…
        </div>
      ) : (
        <>
          {!!db?.notebooks.length && (
            <div className="library-picker">
              <BookOpen size={15} />
              <label className="sr-only" htmlFor="notebook-select">
                Choose notebook
              </label>
              <select
                id="notebook-select"
                value={notebook?.id ?? ''}
                onChange={(e) => setSelected(e.target.value)}
              >
                {[...db.notebooks].reverse().map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                    {n.finishedAt ? ' · Finished' : ''}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                aria-label="Refresh conversation"
                disabled={!context || busy}
                onClick={() => {
                  void act(async () => {
                    await refreshContext();
                    if (tabId.current) await refreshCurrentConversation();
                    await load();
                  });
                }}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          )}
          {notebook ? (
            <>
              <section className="notebook-cover">
                <div className="cover-top">
                  <span className="eyebrow">YOUR KNOWLEDGE NOTEBOOK</span>
                  <span className="status-pill">
                    <span className="dot" />
                    {collecting ? 'Live' : notebook.finishedAt ? 'Finished' : 'Paused'}
                  </span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(() => storage.renameNotebook(notebook.id, title));
                  }}
                >
                  <div className="title-row">
                    <label className="sr-only" htmlFor="notebook-title">
                      Notebook title
                    </label>
                    <input
                      id="notebook-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={200}
                      disabled={busy}
                    />
                    {title !== notebook.title && (
                      <button
                        className="icon-button"
                        aria-label="Save notebook title"
                        disabled={busy || !title.trim()}
                      >
                        <Check size={17} />
                      </button>
                    )}
                  </div>
                </form>
                <p className="meta">
                  {notebook.platform} · {chaptersOf(notebook.messages).length} chapters ·{' '}
                  {notebook.highlights.length} saved{' '}
                  {notebook.highlights.length === 1 ? 'idea' : 'ideas'}
                </p>
                <a className="source-link" href={notebook.website} target="_blank" rel="noreferrer">
                  Open source conversation <ArrowUpRight size={13} />
                </a>
                <p className="reading-hint">
                  Save the ideas you want to return to. Highlight on ChatGPT or while reading here.
                </p>
              </section>
              <NotebookView
                notebook={notebook}
                busy={busy}
                onChange={setDb}
                onAction={(fn) => {
                  void act(fn);
                }}
              />
              <div className="document-actions">
                <button
                  className="secondary-button save-pdf-button"
                  disabled={busy || !notebook.messages.length}
                  onClick={() => {
                    void act(async () => {
                      if (collecting && tabId.current && currentId === notebook.id)
                        await refreshCurrentConversation();
                      const latest = (await storage.listNotebooks()).notebooks.find(
                        (n) => n.id === notebook.id,
                      );
                      if (!latest) throw new Error('Notebook no longer exists.');
                      const { exportNotebookPdf } = await import('../pdf/notebookExporter');
                      await exportNotebookPdf(latest);
                    });
                  }}
                >
                  <Download size={15} />
                  Save study PDF
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !!notebook.finishedAt}
                  onClick={() => {
                    void act(async () => {
                      if (collecting && tabId.current && currentId === notebook.id)
                        await refreshCurrentConversation();
                      return storage.finishNotebook(notebook.id);
                    });
                  }}
                >
                  <Check size={14} />
                  Finish
                </button>
                <button
                  className="icon-button"
                  aria-label="Clear highlights"
                  disabled={busy || !notebook.highlights.length}
                  onClick={() => setClear(true)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {clear && (
                <div className="confirm" role="alert">
                  <p>Remove this notebook’s highlights and notes? The full conversation stays.</p>
                  <button className="text-button" onClick={() => setClear(false)}>
                    Keep notes
                  </button>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      void act(async () => {
                        const result = await storage.clearHighlights(notebook.id);
                        setClear(false);
                        return result;
                      });
                    }}
                  >
                    Clear highlights
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <BookOpen size={32} />
              <h2>A place for your next great idea.</h2>
              <p>
                Create notebook to capture questions and complete answers. Your notes stay alongside
                the passages they belong to.
              </p>
              {!context && (
                <p>
                  Open an existing ChatGPT conversation. Claude and Gemini support is coming later.
                </p>
              )}
            </div>
          )}
          <button
            className="secondary-button new-notebook"
            disabled={!context || busy}
            onClick={() => {
              if (context)
                void act(async () => {
                  const snapshot = tabId.current
                    ? await conversationFromTab(tabId.current)
                    : context;
                  const result = await storage.createNotebook(snapshot);
                  setSelected(result.activeByConversation[conversationKey(snapshot)] ?? '');
                  return result;
                });
            }}
          >
            <Plus size={15} />
            New notebook for this conversation
          </button>
          <footer>Stored on this device · Yours to keep</footer>
        </>
      )}
    </main>
  );
}
