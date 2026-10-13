# AI Notebook 2.0.1: full-conversation capture and export fix

The existing project was modified in place. Its notebook model, IndexedDB database, migration, worker write queue, and chaptered reader/exporter were retained.

## Root cause and evidence

The PDF generator already iterated the notebook's messages; it did not intentionally export only highlights. It also accepted an empty `messages` array, however, so a failed capture silently produced a PDF containing only metadata.

The old extractor depended on `data-message-author-role` and preferred `.markdown` without independent role/turn fallbacks. On the semantic four-message fixture, the old selector returns **0** message nodes. The corrected extractor returns **4**, with roles `user, assistant, user, assistant`, and full answer text.

The panel also lacked content-script recovery for tabs opened before installation. It now verifies the active tab URL, checks the connected script's version, injects the packaged content script when necessary, and obtains a fresh snapshot before activation. Duplicate injected observers/listeners are prevented by an isolated-world ownership guard and cleanup.

The automated test downloads two real PDFs and parses their content with PDF.js. Both contain all four full messages in order; the annotated export additionally contains “uses labeled data” and “Important definition” below the second assistant answer. This is stronger than merely checking that a file starts with `%PDF-`.

This reproduces and fixes the empty-extraction failure mode on browser fixtures. It does not establish which DOM variant was responsible in every signed-in live ChatGPT deployment; native live verification remains necessary.

## Files changed

Production capture and connection:

- `src/content/chatgpt/detector.ts`: author, turn, semantic, and visibility selectors.
- `src/content/chatgpt/extractor.ts`: role fallbacks, deduplication, clean structured text, code indentation, and development diagnostics.
- `src/content/chatgpt/history.ts`: uses detected message containers when locating the chat scroller.
- `src/adapters/ChatGPTAdapter.ts`: development extraction summary.
- `src/content/index.ts`: ping/version handshake, observer ownership, reinjection cleanup.
- `src/notebook/connection.ts`: new shared supported-tab and content-script recovery layer.

Reader and export:

- `src/notebook/App.tsx`: fresh activation snapshots, loaded-message retries, connection errors, import count, fresh New Notebook snapshots, empty-export button guard.
- `src/notebook/NotebookView.tsx`: selection limited to assistant answers.
- `src/content/toolbar.ts`: viewport clamping and repositioning when the note editor expands.
- `src/styles/notebook.css`: connection status styling.
- `src/pdf/notebookExporter.ts`: refuses an empty conversation instead of generating a metadata-only export; retains all existing full-message rendering.

Packaging, verification, and documentation:

- `manifest.json`: version 2.0.1, scripting permission, host access restricted to ChatGPT.
- `package.json`, `package-lock.json`: version and PDF-text verification dependency/command.
- `tests/fixtures/chatgpt-semantic.html`: requested existing four-message conversation without legacy author attributes.
- `tests/extraction-regression.test.ts`: old-selector count and new extraction diagnostics.
- `tests/parser.test.ts`: format preservation, UI exclusion, streaming identity, 50 loaded messages.
- `tests/connection.test.ts`: pre-installation tabs, existing connections, concurrent recovery, unsupported URL rejection.
- `tests/pdf.test.ts`: rejects empty notebooks.
- `scripts/pdf-text.mjs`: shared PDF.js text verification.
- `scripts/acceptance.mjs`: exact two-export acceptance test, including disconnected-tab recovery.
- `scripts/smoke.mjs`: now asserts actual exported conversation text and notes.
- `README.md`, `FIX_NOTES.md`: updated installation instructions and fix explanation.

## Extraction flow

1. Query the current active tab and verify an HTTPS ChatGPT hostname.
2. Ping the content script and compare its extension version.
3. If missing or outdated, inject `content.js`. The content script disposes an older owned observer and avoids duplicate installation.
4. Request a fresh conversation snapshot, rather than using a polled snapshot cached before the button click.
5. Detect all visible/loaded message containers inside the conversation, using author attributes, turn roles, and semantic role headings.
6. Resolve each message role and stable ID, serialize paragraphs, headings, lists, and code, and exclude controls/navigation/hidden content.
7. Preserve DOM order, optional absolute turn order, and timestamps when available.
8. Import the existing conversation into the current notebook and report the imported count.
9. Continue observing DOM changes and update the same stored message during streaming. Snapshot merging preserves captured turns hidden later by virtualization.

## Model and annotations

`Notebook.messages` holds the full ordered conversation. Each message has `id`, `role`, `text`, optional platform `order`, and optional `timestamp`. Notebook metadata includes title, platform, conversation ID, source URL, created/updated times, and finish state.

`Notebook.highlights` is a separate annotation array. Each annotation references a `messageId` and stores its selected quote, offsets, prefix/suffix context, color, note, UUID, and creation time. The notebook reader resolves anchors within that message. Removing an annotation leaves the full message intact.

Large notebook records and active/paused metadata remain in IndexedDB; small settings remain in Chrome Storage. No database format rewrite or archive reset was introduced.

## PDF behavior

The PDF generator consumes the stored notebook model. It renders title/metadata, every chapter, each complete user and assistant message in order, and that message's highlights/notes underneath. It wraps long text, paginates, and numbers pages. No highlight is required for the conversation body to render.

A notebook with no nonblank messages now throws a meaningful error. An empty reader also disables Export. The existing bundled font behavior is unchanged: unsupported glyphs are printed as `[U+CODEPOINT]` tokens.

## Build and automated tests

Use Node 22.12+ in the 22 LTS line, or Node 24+.

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:acceptance
npm run test:e2e
npm run format:check
```

Verified in this workspace: 30 tests, strict TypeScript, production build, browser smoke, and the exact PDF acceptance test. Evidence is in `artifacts/acceptance-results.json`, `artifacts/acceptance-no-highlights.pdf`, and `artifacts/acceptance-annotated.pdf`. Both PDF layouts and page numbering were visually checked.

## Exact Chrome installation and live test

1. Run `npm run build`.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose Load unpacked and select this project's **dist** directory. If already installed, reload its card and check version **2.0.1**. Allow the updated ChatGPT site permissions if Chrome requests them.
4. Keep an existing ChatGPT conversation open; automatic reconnection should work without a page reload.
5. Use a conversation containing “What is machine learning?”, its full answer, “What is supervised learning?”, and its full answer containing “uses labeled data”.
6. Click the extension icon, then Activate Notebook Mode. Confirm **4 messages imported** and both complete question/answer chapters.
7. Export before highlighting. Confirm all four full messages are present in their original order.
8. Select “uses labeled data” in the second assistant answer. Click Add Note, enter “Important definition”, and save Definition/green.
9. Export again. Confirm the full conversation remains, with the selected passage and note underneath the second answer.
10. Add another question and wait for its answer. Verify the same notebook updates without duplicate streaming messages. Reopen the notebook and verify the highlight remains attached.

If capture returns zero loaded messages, the panel displays an error and prevents an empty export. Reload the extension connection with Retry connection, wait for the page to load, or use a page reload as a troubleshooting fallback. Hidden server-side history still cannot be recovered by DOM extraction.

## Follow-up: verified live DOM failure and 2.0.2 fix

The reported zero-message error was reproduced in the user's signed-in Chrome session. Read-only DevTools inspection found **zero legacy role nodes, zero article wrappers, and two main roots**. The first main belonged to a stale conversation under a parent with `display: none !important`. The active root contained `data-chatgpt-search-unit-key` and `data-content-search-unit-key`, with role suffixes such as `:user` and `:assistant`; nested user markers represented the same message twice.

`detector.ts` now selects a visible root containing message markers. `extractor.ts` supports the observed unit-key roles and message-ID lists and retains only one record for nested markers. The new live-layout regression fixture and test cover both problems. Manifest/package version is 2.0.2; the connection test's version handshake was updated accordingly.

The existing installed extension was reloaded from this project's dist folder in Chrome, then Notebook Mode was activated on the open conversation. The native UI reported **4 messages imported**, displayed **2 chapters**, and showed both full assistant responses. PDF export downloaded `Test received.pdf`; its extracted text was checked for both user questions and complete assistant content in order, without highlights. This is a live verification, in addition to the automated fixtures.

## Sentence highlighter and colored PDFs (2.1.0)

Added a persistent color palette to `NotebookView.tsx`: yellow, green, red, and a Select text mode for notes via the floating toolbar. Choosing a color makes drag-selection save and paint the sentence immediately. Existing notebook data and notes remain compatible.

`highlighter.ts` now provides a shared anchored segment function used by the React reader and PDF renderer. `pdf/textLayout.ts` wraps those segments without discarding characters or losing their color; `notebookExporter.ts` draws color rectangles behind the matching text runs before drawing the complete line. The same highlights are visible inside answers and in their annotation sections. Notes remain attached to the source message.

The packaged 2.1.0 extension was reloaded in native Chrome and the new palette was verified visible. Automated browser acceptance includes a real mouse drag, yellow/green/red selections, saved notes, and full conversation export. The exported backgrounds were checked against the locations of the original answer text.
