# Changelog

## Unreleased — hardening

- Added an optional Ko-fi link in About and a dismissible inline thank-you after the third successful PDF export. The counter and permanent dismissal stay local; there are no new permissions, analytics, background network requests, pop-ups, or feature restrictions. The Ko-fi page opens only when its link is clicked.
- Fixed manifest formatting.
- Added CI for pushes and pull requests: install, typecheck, unit tests, build, formatting, and headless Chromium smoke.
- Added an MIT license as a placeholder for the project owner to review. Bundled fonts retain their own licenses.
- Separated current usage from historical release notes and corrected highlight selection scope.
- Request persistent storage from the extension page after a notebook is saved or loaded, without adding permissions. Denied, unsupported, and failed requests do not block notebook operations; attempts are limited to once per page session.

## 3.0.3

- Improved source-page selection handling and toolbar recovery after host-page changes.
- Added regression coverage for selection events and replaced answer DOM.

## Historical release notes

The following notes were moved from the previous README. Version numbers, installation instructions, test counts, and verification statements below describe their historical context; use [README.md](README.md) for the current build and installation instructions. Detailed early fix analysis remains in [FIX_NOTES.md](FIX_NOTES.md).

## Metadata-only PDF fix (2.0.1)

The exporter already iterated `Notebook.messages`. The reproducible failure was upstream: a conversation using semantic turn/heading markers but lacking `data-message-author-role` produced **zero extracted messages** with the old selector. The old PDF generator accepted an empty notebook and still wrote its metadata cover. Tabs predating installation also lacked a reliable content-script recovery path.

The existing architecture is preserved. The corrected flow is:

```text
Current active tab → validate ChatGPT URL → ping/version-check content script
→ inject/reconnect when needed → fresh structured conversation extraction
→ import existing messages → IndexedDB notebook → live message updates
→ export every stored message → attach highlights/notes under the source answer
```

Activation waits briefly for loaded messages in an existing `/c/...` conversation and shows an error if none are found. Blank new chats can still enter Notebook Mode and wait for their first message. Empty notebooks cannot be exported: both the button and PDF generator guard against a metadata-only output.

Each notebook retains its `messages` and `highlights` arrays. Messages have stable IDs, roles, full clean text, optional platform order, and optional timestamps; the array preserves conversation order. Each highlight references `messageId` and stores its quote, offset/context anchor, color, note, and creation time. Highlight removal never removes the surrounding answer. Full messages are rendered and exported even when `highlights` is empty.

Development extraction diagnostics print the title, message count, each role, and a 100-character preview. Production builds do not log conversation previews. The unit regression prints legacy selector count **0** and verifies new extraction count **4** on `tests/fixtures/chatgpt-semantic.html`.

Run the exact PDF acceptance test:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:acceptance
npm run test:e2e
```

`test:acceptance` downloads and parses two real PDFs with PDF.js: one with no highlights and one with the requested highlight and note. It asserts the full text of all four messages in their original order in both PDFs, excludes copied UI controls, and checks annotation placement. It also simulates a disconnected pre-installation tab and verifies reconnection. Evidence is saved as `artifacts/acceptance-results.json`, `artifacts/acceptance-no-highlights.pdf`, and `artifacts/acceptance-annotated.pdf`.

To test the installed build in Chrome:

1. Build the project with `npm run build`.
2. Open `chrome://extensions`, enable Developer mode, and load `dist` (or reload the existing AI Notebook card). Check that its version is **3.0.0**.
3. Open an existing ChatGPT conversation with these four messages: “What is machine learning?”, a complete answer, “What is supervised learning?”, and a complete answer containing “uses labeled data”.
4. Click the extension icon and **Activate Notebook Mode**. Confirm **4 messages imported** and that both full question/answer chapters appear. No manual copying or adding messages is needed.
5. Export before highlighting and confirm the full conversation is in the PDF.
6. Select “uses labeled data” inside the second assistant answer, add “Important definition”, and save a highlight.
7. Export again and confirm both complete answers and both questions remain, with the highlight and note under the second answer.
8. Continue chatting; verify new turns update the same notebook without duplicate streaming messages. Reload the notebook panel and confirm annotations remain attached.

The automated acceptance test uses a realistic DOM fixture; a signed-in live ChatGPT check is still required because site markup can change independently.

## Live ChatGPT capture fix (2.0.2)

A signed-in Chrome inspection identified two issues that the earlier fixture did not cover: ChatGPT retained an old conversation in a hidden first `main`, and the visible conversation used `data-chatgpt-search-unit-key` / `data-content-search-unit-key` markers instead of legacy role attributes or article elements. The extractor now chooses a visible conversation root, reads user/assistant roles from those unit keys, deduplicates nested markers, and uses `data-chatgpt-search-message-ids` for stable identity when available.

The regression fixture `tests/fixtures/chatgpt-live-layout.html` reproduces the hidden old root and observed message-marker layout. Version 2.0.2 was reloaded in the existing native Chrome installation and verified on the open conversation: four messages, two chapters, both complete answers, and a downloaded PDF containing both prompts and answers in order with zero highlights. No chat messages were sent or changed during verification.

## Sentence highlighter and PDF colors (2.1.0)

The notebook now includes a visible **Sentence highlighter** bar. Choose **Yellow**, **Green**, or **Red**, then drag across a sentence in an assistant answer. The selection is saved and colored immediately. **Select text** switches back to the floating toolbar, where you can add a note before saving; existing annotations also have an Edit note button.

PDF exports now paint the same colored background directly behind highlighted words in the full original answer, as well as the quoted passage in Highlighted Notes. Highlight anchors and overlap precedence are shared with the notebook reader. The exporter carries colors through line wrapping, explicit paragraph breaks, page breaks, code indentation, and unsupported-glyph substitutions, then draws each full line as selectable PDF text. All unselected conversation text remains present.

The acceptance test also exercises a real mouse drag with the yellow highlighter, saves green/red annotations, and downloads `artifacts/acceptance-colored-highlights.pdf`. The color backgrounds were visually inspected and checked against the text locations in that PDF. Layout tests cover long wrapped highlights, overlapping colors, code indentation, glyph substitutions, and colored rectangles across multiple pages.

## Highlight on the original ChatGPT page (2.2.0)

Select a sentence directly in the main ChatGPT conversation. The floating toolbar offers **Highlight** (yellow), **Definition** (green), **Important** (red), **Add Note**, and **Cancel**. The side panel can stay closed. Your first saved highlight creates a notebook if needed; visiting a chat alone does not save it. Existing paused or finished notebooks accept annotations without restarting automatic capture.

Highlights appear on the original page, survive reloads, and appear in the notebook and full PDF using the same colors. Remove a highlight or clear highlights from the notebook to remove its page color. Selections can span formatting and paragraphs within one message; select each message separately.

After upgrading, rebuild with `npm run build`, reload AI Notebook in `chrome://extensions`, then reload the ChatGPT tab. The installed extension should show **3.0.0**. Run `npm run test:source` to check real mouse selection on the original page, notes, notebook persistence, reload restoration, PDF export, and clearing.

Source colors use the CSS Custom Highlight API so ChatGPT's React-owned nodes remain intact. Conversation-local source saves are validated in the background worker and committed atomically with the corresponding message and annotation.

### Upgrade mismatch fix (2.2.1)

If the main-page toolbar reports `Invalid notebook request.`, Chrome may still be running an older background worker even though the page loaded the rebuilt content script. Version 2.2.1 checks worker support before saving and gives explicit reload instructions. Reload **AI Notebook itself** in `chrome://extensions`, then reload the ChatGPT tab. Rebuilding or refreshing only the webpage does not update the worker.

### Saved conversation navigation fix (2.2.2)

ChatGPT navigates between saved conversations without replacing the browser document. The sender metadata can retain the original document URL. Main-page highlighting now validates the sender origin and the tab's current URL rather than comparing against the original route. This supports older chats, project chats, and new chats that acquire saved conversation URLs, while rejecting selections saved after the tab moves to a different conversation. The browser source-highlight test covers navigating to an existing project conversation without a page reload.

## Persian PDF export (2.3.0)

Export full PDF now supports Persian titles, questions, answers, highlights, and notes. Persian paragraphs align to the right, letters use joined forms, and mixed English terms and Persian/Latin numbers retain their proper visual order. Half-spaces influence letter joining. Highlights follow the shaped text through wrapping and page breaks, including selections over ligatures. English paragraphs retain left alignment.

The extension bundles Noto Naskh Arabic alongside Noto Sans; font files load locally, so export works offline. Noto Naskh Arabic comes from the [official Noto repository](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoNaskhArabic) under the bundled `NotoNaskhArabic-OFL.txt` license. No notebook content is uploaded. PDF copy/search behavior for joined Arabic glyphs can vary by reader.

Reload AI Notebook in `chrome://extensions`, confirm **2.3.0**, and reload ChatGPT before exporting. Run `npm run test:persian` for the browser download test with Persian text, all three highlight colors, mixed English terms, Persian numbers, multiple pages, and a Persian filename.

## Arc and Firefox (2.4.0)

`npm run build` produces these independent distributions:

| Browser              | Load directory  | Notebook interface                                                    |
| -------------------- | --------------- | --------------------------------------------------------------------- |
| Chrome / Edge        | `dist`          | Native side panel                                                     |
| Arc                  | `build/arc`     | Persistent notebook window attached to the originating browser window |
| Firefox desktop 140+ | `build/firefox` | Native Firefox sidebar                                                |

### Arc installation

1. Open `arc://extensions`.
2. Enable Developer mode, choose **Load unpacked**, and select `build/arc` in this project.
3. Reload your ChatGPT tab. Click **AI Notebook** in Arc's extensions to open the notebook popup. You can also highlight on the ChatGPT page while the notebook window is closed.
4. Click **Keep notebook open** to open a separate notebook window alongside your chat. Switching chats within the originating browser window updates its notebook context. The Keep notebook open button reuses the notebook window. If Arc rejects extension windows, it opens a notebook tab connected to the original chat.

Arc uses its dedicated build so its action does not depend on Chrome's side-panel API. See [Arc's extension controls](https://resources.arc.net/hc/en-us/articles/19434259167767-Extensions-in-Arc-How-to-Import-Add-Open).

### Firefox installation

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**, then select `build/firefox/manifest.json`.
3. Reload ChatGPT. Click the AI Notebook toolbar button to open Firefox's native sidebar; grant access to ChatGPT if Firefox asks.
4. Highlights, local notebook storage, notes, old conversations, and English/Persian PDF export use the same implementation.

Temporary add-ons are removed when Firefox restarts. A permanent release installation requires Mozilla signing; the generated XPI is currently unsigned. Use the [temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) and [Mozilla signing guide](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). Firefox 140+ is required because page highlighting uses the [CSS Custom Highlight API added in Firefox 140](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/140). Mobile browsers are not a supported target.

### Packages and verification

`npm run package` builds and creates `packages/ai-notebook-chrome-3.0.0.zip`, `packages/ai-notebook-arc-3.0.0.zip`, and `packages/ai-notebook-firefox-3.0.0.xpi`. Archives have their manifest at the root, include both bundled fonts/licenses, and omit source maps.

- `npm run test:arc`: loads the Arc distribution in isolated Chromium, verifies the separate notebook window stays connected to its source window, and captures old/project chats after client-side navigation. This verifies the Arc build's Chromium behavior; it is not a native Arc UI test.
- `npm run test:firefox`: temporarily installs the actual Firefox build in an isolated, headless Firefox profile. Checks real Firefox background messaging, main-page highlights, restoration after reload, full notebook messages, and PDF download. It uses a local HTTPS ChatGPT fixture and does not alter your normal browser profile. Defaults to `/Applications/Firefox.app/Contents/MacOS/firefox`; override `FIREFOX_BINARY` on other platforms. Requires OpenSSL and downloads pinned geckodriver 0.37.1 on first run.
- `npm run lint:firefox`: runs Mozilla's add-on linter. The current build has zero errors; warnings concern bundled third-party React/PDF/HTML-library patterns and need review when submitting for signing.

The browser API boundary uses Firefox's native Promise-based `browser` APIs and Chromium's `chrome` APIs. Extension origins are obtained with `runtime.getURL`, supporting Firefox's `moz-extension` scheme. Background listeners and IndexedDB's serialized writer are shared; Firefox uses an MV3 event background rather than a Chromium service worker. Archives stay local to the browser/profile where they were saved; cross-browser sync is not implemented.

### Arc toolbar launch fix (2.4.1)

The Arc manifest now declares `action.default_popup` so clicking AI Notebook immediately opens the notebook through the browser's native extension-popup mechanism. The initial UI no longer depends on a background action-click handler creating a window. Keep notebook open creates or reuses a separate notebook window, with a notebook-tab fallback if extension windows are rejected. Both preserve the source chat context; the fallback tab does not attempt to capture its own extension page.

Reload the extension loaded from `build/arc` in Arc's extension manager and confirm **2.4.1**, then reload the ChatGPT tab. The Arc regression now actually calls `action.openPopup`, inspects the rendered toolbar popup, clicks Keep notebook open, and verifies notebook activation and old/project navigation. It runs in isolated Chromium; native Arc UI behavior still requires verification in Arc.

## A personal knowledge notebook (3.0.0)

- **Home:** your title, optional personal overview, topics, key insights drawn from saved highlights, and a chapter list. Bookmarked ideas are prioritized. Topic chips combine source keywords and your highlight tags; no AI summary is generated. Paste a summary from your AI conversation or write your own in Your overview.
- **Read:** quiet question/response cards, inline colored highlights, and notes in the margins. Browse chapters or jump directly from an insight to its source. A jump beyond the first 20 chapters loads the relevant chapter automatically. Persian text uses automatic text direction in cards and notes.
- **Highlights:** one searchable collection across the notebook. Find text, notes, or tags; filter by bookmark or tag; return to the original passage. Edit a note and comma-separated tags together, bookmark an idea, or remove a highlight.
- **Save study PDF:** a secondary action after the notebook. The export has a title-led cover, clickable contents with accurate page numbers, an overview/topics section, question-titled chapters with complete questions and responses, and a saved-highlight collection with personal notes, tags, and bookmarks. Your pasted summary is included when present. English and Persian rendering remains supported.

Highlight metadata and personal overviews commit through the existing serialized background writer. They are optional fields, so existing IndexedDB notebooks require no destructive migration. Manual overviews are preserved when new replies arrive. No AI provider, model download, account, network permission, or cloud transmission was added.

Run `npm run test:ux` to verify the complete knowledge-notebook flow, annotation/search/bookmark/tag persistence, manual overview persistence, late chapter navigation, and the study PDF. Screenshots are saved as `artifacts/knowledge-home.png`, `artifacts/knowledge-home-dark.png`, and `artifacts/knowledge-highlights.png`; a study PDF preview is saved as `output/pdf/study-notebook.pdf`.

Reload the current browser build and confirm **3.0.0**: Chrome/Edge `dist`, Arc `build/arc`, Firefox `build/firefox`. Then reload your ChatGPT tab.
