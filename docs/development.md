# Development and verification

Use Node.js 22.12+ in the 22 LTS line, or 24+, and npm.

```sh
npm ci
npm run check
npm run format:check
npx playwright install chromium
node scripts/smoke.mjs
node scripts/notebook-ux.mjs
node scripts/source-highlights.mjs
node scripts/acceptance.mjs
```

`check` runs strict TypeScript, unit tests, and the production build. Browser scripts load the packaged extension against intercepted ChatGPT fixtures in temporary profiles; they do not verify signed-in ChatGPT or native browser UI. The UX script also regenerates `output/pdf/study-notebook.pdf`.

CI runs on pushes and pull requests using Node 24 on Ubuntu, including a headless packaged-extension smoke test. GitHub execution must be checked after pushing; local passing checks do not prove the hosted workflow has run.

`npm run dev` serves the reader at `/sidepanel.html`; capture requires extension installation. Rebuild and reload the extension for functional changes. `npm run package` generates browser archives with the manifest version in their names and no source maps.

Additional checks:

- `npm run test:persian`: Persian PDF browser download.
- `npm run test:claude`: claude.ai capture against a synthetic fixture, using a package copy with Claude access pre-granted (the browser permission prompt cannot be automated). Covers dynamic content-script registration, notebook connection, rich capture, and on-page highlights.
- `npm run test:arc`: shared Chromium distribution, including actual side-panel opening, silent/rejected API fallback, saved surface choice, and persistent window; native Arc UI still needs manual verification.
- `npm run test:firefox`: actual headless Firefox with a temporary add-on and local HTTPS fixture. Requires OpenSSL and geckodriver; defaults to `/Applications/Firefox.app/Contents/MacOS/firefox`, overridable with `FIREFOX_BINARY`.
- `npm run lint:firefox`: add-on lint; review bundled-library warnings before signing.

## Architecture plan

### Persistent-storage policy

The extension page requests `navigator.storage.persist()` once it has a saved notebook, including archives loaded on reopening. It checks an existing grant first, handles unsupported APIs and failures, and makes at most one attempt per page session. Content scripts never make this request: that would target the ChatGPT origin rather than the extension. Notebook writes still belong exclusively to the serialized worker; persistence does not change the database schema or lifecycle state.

`unlimitedStorage` has deliberately not been added. Chrome documents it as exempting extension/web storage from quota restrictions and eviction, while `persist()` requests protection from eviction without lifting quota. The broader permission can support large archives but still is not a backup or protection against user deletion/uninstall. Review the permission with the project owner before adding it. See [Chrome storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) and [StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

The extension has four boundaries:

1. **Platform adapters and content extraction** detect the conversation and capture its ordered messages, title, stable message IDs, and timestamps when available. Only the ChatGPT adapter is enabled.
2. **Background worker and persistence** serialize validated notebook operations. Large notebook bodies and session metadata commit atomically in IndexedDB; Chrome Storage holds small preferences and migration metadata.
3. **React side-panel notebook** presents full conversation chapters, anchored inline highlights, comments, and a notebook library. Capture is explicitly activated, and new chat turns update the same notebook.
4. **PDF exporter** uses the same chapter grouping as the reader and includes all captured conversation text, highlighted notes, source metadata, and page numbers.

## Project structure

```text
manifest.json                       MV3 action, side panel, supported hosts, permissions
sidepanel.html                      Notebook UI entry point
scripts/build.mjs                   Vite reader, ES worker, IIFE content bundle
src/
  adapters/
    ChatGPTAdapter.ts               Working AIPlatformAdapter
    ClaudeAdapter.ts                Disabled future adapter contract
    index.ts                        Adapter registry and snapshot creation
  background/
    serviceWorker.ts                Message validation, serialized writes, migration
  content/
    index.ts                        Opt-in capture, DOM observer, SPA lifecycle
    chatgpt/
      detector.ts                   ChatGPT DOM selectors
      extractor.ts                  Role/structure fallbacks, clean text, stable IDs, debug summaries
      history.ts                    Bounded older-history scan and scroll restoration
    highlighter.ts                  Shared quote/context anchor utilities
    toolbar.ts                      Isolated selection toolbar and note editor
  notebook/
    App.tsx                         Notebook Mode, library, themes, actions
    connection.ts                  URL checks, version handshake, on-demand content injection
    NotebookView.tsx                Chapter reader and notebook text selection
    Message.tsx                     Full message and editable annotations
    Highlight.tsx                   React-rendered inline highlights, including overlaps
    chapters.ts                     Shared chapter grouping for reader and PDF
    main.tsx                        React entry point
  storage/
    storage.ts                      Typed messaging/storage client abstraction
    indexedDB.ts                    Per-notebook records and atomic session metadata
    repository.ts                   Pure notebook lifecycle transitions
    validation.ts                   Runtime request/payload validation
    settings.ts                     Small Chrome Storage preferences
  pdf/
    notebookExporter.ts             Full chaptered PDF, local font, pagination
  types/index.ts                    Message, notebook, adapter, and command types
  styles/notebook.css               Tailwind and responsive light/dark reader styling
public/
  fonts/                            Bundled Noto Sans, Noto Naskh Arabic, and OFL licenses
  icons/                            Extension icons
```

## Persistence and engineering notes

The worker is the sole writer. It reads the current IndexedDB state before each queued transition; notebook records and active/paused session metadata commit together. Callers wait for transaction completion, not merely request success. Only changed notebook records are written. A failed write reports an error and keeps the previously committed archive.

Existing AI Marker `aiMarker.v1` archives are migrated on first access. The old Chrome Storage blob is removed only after a successful IndexedDB commit. The schema is versioned; future data changes should introduce explicit migrations. Migrated notebooks start paused until Notebook Mode is explicitly activated. Small theme and migration settings remain in Chrome Storage.

Snapshot merging retains messages removed temporarily by DOM virtualization. Newly discovered older turns are inserted before known following turns; when platform turn indices are available, those indices establish full ordering. The extractor checks explicit author attributes, turn roles, and semantic role headings. It removes buttons, hidden content, and navigation before serialization. No site HTML is injected into the notebook: content is rendered as text. Highlights are React elements, so capture never wraps or mutates the original chat answer DOM.

Worker invalidation messages refresh both side-panel views and content-script activation state. Content scripts cannot directly access the trusted Chrome Storage area or extension-origin IndexedDB. Background listeners are registered synchronously. All scripts, styles, icons, and fonts are local and compatible with Manifest V3's CSP. PDF dependencies are lazy-loaded.

## Future adapters and services

Implement **AIPlatformAdapter** with `detectConversation()`, `extractMessages()`, `extractTitle()`, and `getConversationId()`. Register it in `src/adapters/index.ts`, add extraction fixtures and browser tests, then enable the platform's host patterns and validation URL allowlist. Claude's disabled adapter illustrates the contract; Gemini and Perplexity use the same boundary. None is advertised as working in this MVP.

Cloud sync and accounts should sit behind the persistence boundary, preserve UUIDs, define conflict resolution and deletion, and be explicitly opt-in. A summary provider should consume notebook snapshots through a separate service; credentials and network calls belong outside content scripts. No inactive account or summary code is executed today.

## Live release checks

1. Install in Chrome and Edge; verify clicking the icon opens the native side panel.
2. On both supported ChatGPT hosts, activate an existing long conversation and a new chat. Verify title, chronological chapters, full messages, history scanning, cancellation, and scroll restoration.
3. On the original page, highlight passages in questions and answers. In the notebook reader, highlight assistant answers only. Test paragraphs, lists, and code. Add/edit notes, test each category, overlapping highlights, keyboard selection, and Escape.
4. Continue chatting, stream and regenerate answers, navigate between conversations, and verify that only activated conversations update their notebooks.
5. Pause, resume, finish, reload, and reopen the browser. Verify session state and archive preservation.
6. Export multiple-page conversations; check chapter numbers, complete answers, comments, glyph fallbacks, and page numbering.
7. Verify legacy migration, transaction failure handling, both themes, unsupported tabs, and large archives.

References: [Chrome sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Microsoft Edge sidebar](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [jsPDF](https://github.com/parallax/jsPDF).
