# AI Notebook: project story, assessment, and strategy

Reviewed: **17 October 2026**  
Current version: **3.0.3**, from `package.json` and `manifest.json`  
Repository: `ai-marker-extension`; package/product name: `ai-notebook` / **AI Notebook**

This report describes the repository as reviewed, including fresh local checks. Historical observations are attributed to the existing documentation; proposed priorities, positioning, and milestones are recommendations, not shipped features or evidence of market demand. No external market research or live signed-in ChatGPT verification was performed for this report.

## 1. The project in one paragraph

AI Notebook is a desktop browser extension that turns ChatGPT conversations into reusable study material. Users capture a conversation, read it as chapters, highlight passages, add notes and tags, bookmark ideas, revisit their sources, and export a study PDF. It stores the notebook locally and makes no model calls. Its strongest direction is helping people keep and revisit what they learn through AI conversations. The implementation is substantial enough for a focused pilot, but backup, capture confidence, release validation, and evidence of repeat use need attention before treating it as a broadly proven product.

## 2. The problem and intended value

An AI conversation can contain useful explanations spread across a long stream of questions and answers. Saving a link preserves access to the conversation, but does little to identify the important passages or connect them to personal notes. Copying selected answers into another tool adds work and can lose context.

AI Notebook addresses that workflow through four steps:

1. **Capture:** preserve the available conversation text in a local notebook.
2. **Understand:** organize questions and responses into readable chapters.
3. **Keep:** attach highlights, notes, tags, and bookmarks to their source passages.
4. **Revisit:** return through the notebook home, chapter navigation, highlight search, or PDF.

The PDF is a useful output, while the continuing notebook is the opportunity for ongoing value. A user who exports once has completed an occasional task; a user who regularly returns to saved ideas has established a habit. Whether that habit forms is still an unanswered product question.

## 3. How the project reached its current form

The repository and legacy storage key show an evolution from **AI Marker** toward **AI Notebook**. Most of the early implementation arrived in the first visible commit, so the detailed version narrative below comes partly from `README.md` and `FIX_NOTES.md`, rather than a separate Git commit for every release.

| Stage                       | What changed                                                                                            | Why it matters                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Marker origins              | Highlighting and annotations; legacy archive key `aiMarker.v1`                                          | Established passage-level collection and a compatibility obligation for existing data.                                                  |
| Notebook foundation         | Conversation model, chapter reader, IndexedDB, serialized worker operations, PDF export                 | Made the complete conversation the underlying document.                                                                                 |
| 2.0.1 capture/export repair | Extraction fallbacks, connection recovery, empty-export rejection, PDF text assertions                  | Addressed the failure where a PDF could contain metadata without conversation text.                                                     |
| 2.0.2 live-layout repair    | Visible-root selection and support for additional message markers                                       | Historical notes document a successful native Chrome check against an open conversation. This does not certify current ChatGPT layouts. |
| 2.1.x–2.2.x annotations     | Colored PDF highlights, highlighting on the source page, capability checks, saved-chat navigation fixes | Connected the browser conversation, notebook, and exported document.                                                                    |
| 2.3.x Persian export        | Arabic shaping, mixed text direction, bundled fonts, colored text runs                                  | Added a meaningful multilingual capability.                                                                                             |
| 2.4.x browser packaging     | Chrome, Arc, and Firefox build targets and browser-specific notebook surfaces                           | Expanded distribution while adding compatibility work.                                                                                  |
| 3.0.x notebook experience   | Home, Read, Highlights; personal overview; topics; tags; bookmarks; source-linked insights; study PDF   | Shifted the product toward organizing and revisiting knowledge.                                                                         |
| 3.0.3 current revision      | Source-selection handling, toolbar resilience, related regressions                                      | Continues work on reliability inside a changing host application.                                                                       |

The visible Git history contains four commits, dated 13–15 October 2026. The initial commit already includes a large codebase and tests. That establishes the repository's recorded state, not the total time spent developing the project.

## 4. What is implemented today

### Conversation capture and lifecycle

- ChatGPT is the only enabled AI-platform adapter. Both supported host patterns are declared in the manifest: `chatgpt.com` and `chat.openai.com`.
- Users explicitly start capture through notebook creation/activation. Merely opening a chat does not create a notebook. Saving a highlight on the original page is another explicit action that can create one.
- Capture extracts user and assistant text, message identities, title, and ordering information when available.
- DOM observation updates active notebooks as the conversation changes, including streaming responses.
- A bounded backward history scan attempts to reveal older rendered turns, supports cancellation, and restores the scroll position.
- Snapshot merging retains previously captured turns when virtualization removes them from the page.
- Pause, resume, finish, rename, and creating another notebook for the same conversation are implemented.
- Temporary chats can migrate to a stable conversation identity when matching turns establish continuity.
- Version and capability checks help recover from stale or missing content scripts after extension updates.

### Reading and personal knowledge

- **Home:** editable personal overview, keyword-derived topics, highlight-derived key insights, and chapter navigation.
- **Read:** full captured questions and answers, question-derived chapter titles, inline highlights, and attached notes.
- **Highlights:** search within the selected notebook's highlight text, notes, and tags; tag and bookmark filters; source navigation.
- Yellow, green, and red annotation categories; note editing; tags; bookmarks; individual removal; clearing all highlights.
- Highlighting on the original ChatGPT page, including while the notebook panel is closed, and in assistant answers in the reader. These surfaces have different selection rules and need separate validation.
- Light/dark themes, automatic text direction in relevant content, and incremental reader display starting at 20 chapters.

The overview is **not an AI-generated summary**. Users write or paste the summary. Topics come from local keyword processing and tags; key insights come from saved highlights, with bookmarks prioritized. Chapter titles are derived from question text. These distinctions should remain explicit in product descriptions.

### Export, storage, and distribution

- Study PDFs include captured conversation text, chapters, overview/topics, annotations, notes, tags, bookmarks, contents links, and page numbering.
- PDF layout handles pagination, inline highlight colors, and Persian/Arabic shaping and mixed-direction text using bundled fonts.
- IndexedDB stores notebook records and lifecycle metadata atomically. Small preferences use browser local storage.
- Legacy AI Marker archives migrate only after a successful database commit; capture is paused on migration.
- Chrome/Edge use the `dist/` build; Arc and Firefox have separate generated builds and packaging paths.
- Arc has a toolbar popup and a separate notebook-window workflow; Firefox has a sidebar configuration.
- Packaging creates ZIP/XPI artifacts and excludes source maps. The documented Firefox package is unsigned.

### Explicitly absent or incomplete

There is no enabled Claude, Gemini, or Perplexity capture; cloud sync; account system; collaboration; model-powered summarization; restorable backup/import; notebook deletion command/UI; cross-notebook full-text search; or rich media capture. Claude has a disabled adapter skeleton. Platform names in the type definitions do not establish working integrations.

## 5. How the system works

```text
ChatGPT page
  -> platform adapter and text extraction
  -> extension messaging and runtime validation
  -> serialized background-worker transition
  -> IndexedDB notebooks + lifecycle metadata
  -> React notebook views / source-page highlight restoration
  -> study PDF export
```

| Boundary            | Responsibility                                                             | Main evidence                                                                              |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Extraction          | Detect messages, serialize text, scan history, track navigation            | `src/adapters/`, `src/content/chatgpt/`, `src/content/index.ts`                            |
| Annotation          | Resolve quotes and offsets; map saved text to source ranges                | `src/content/highlighter.ts`, `src/content/sourceHighlighter.ts`, `src/content/toolbar.ts` |
| Persistence         | Validate commands, serialize transitions, commit records and session state | `src/background/`, `src/storage/`                                                          |
| Notebook            | Present the library, home, reader, annotation collection, and controls     | `src/notebook/`, `src/knowledge/overview.ts`                                               |
| Export              | Lay out chapters, text, annotations, fonts, and directionality             | `src/pdf/`                                                                                 |
| Browser integration | Select extension APIs, open notebook surfaces, build distributions         | `src/browser/`, `scripts/build.mjs`, `scripts/package.mjs`                                 |

The central model separates `Notebook.messages` from `Notebook.highlights`. An annotation references its message and stores the quote, offsets, and surrounding context. Removing an annotation leaves the source text intact. Reader and PDF share chapter grouping, reducing the chance of different chapter structures across outputs.

## 6. Strengths

### A coherent end-to-end workflow

Capture, annotation, reading, and export operate on the same notebook. This is a strong product foundation because users can retain context alongside the passages they select.

### Local operation and narrow network scope

The implementation has no backend, analytics service, account system, or model API dependency. Fonts and assets are bundled, and manifest host access is confined to the two ChatGPT hosts. That keeps the operating model simple and avoids per-summary inference costs. Local storage is not encrypted by the extension, so this should not be described as encrypted storage.

### Careful persistence design

The worker is the sole writer, commands are serialized, and notebook/session changes commit together. Failed transactions report errors while preserving the committed state. Migration removes the legacy archive only after a successful commit. These are valuable choices for a product holding users' personal work.

### Source-linked annotations

Quote/context anchors allow some resilience to text movement. Source-page highlighting uses CSS Highlight ranges rather than wrapping ChatGPT-owned answer nodes. Ambiguous anchors can remain unpainted instead of attaching to an uncertain passage.

### Meaningful tests

Tests cover extraction variants, chapter ordering, annotation anchors, source authorization, concurrent writes, migration, commit failures, a large archive, PDF text, and multilingual layout. Browser scripts exercise the packaged extension and inspect downloaded PDF contents. This provides more confidence than checking only whether a button responds or a file downloads.

### Multilingual export work already exists

Persian/Arabic text, mixed English content, and colored annotations receive dedicated handling. This could support a useful niche if target users value it, although broader language coverage is still limited.

### Useful boundaries for future work

Adapters, persistence, UI, and export are separated sufficiently to support targeted improvements without replacing the entire application. No architectural rewrite is justified by the findings in this review.

## 7. Weaknesses and risks

| Priority                      | Finding                                                             | Consequence                                                                                                                                  | Recommended response                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Critical before broad release | No restorable backup/import                                         | Browser-profile loss, uninstall, or corruption can leave users without editable notebooks. PDFs cannot restore the full application state.   | Add versioned JSON export/import with validation, preview, duplicate handling, and round-trip checks.                     |
| High                          | Capture depends on ChatGPT's DOM                                    | Host changes can cause missing messages, wrong roles, unstable identity, or broken selection.                                                | Maintain fixtures from observed failures and a repeatable signed-in release checklist.                                    |
| High                          | History completion is inferred from rendered-page behavior          | Reaching a stable scroll position cannot prove all server-side history was captured.                                                         | Describe capture as available text; distinguish scan outcome from guaranteed completeness.                                |
| High                          | No notebook deletion workflow                                       | Users cannot manage sensitive or obsolete archives through normal product controls.                                                          | Add notebook deletion with explicit confirmation, lifecycle cleanup, and recovery where practical.                        |
| High                          | Archive-wide processing on routine operations                       | Loading all notebook bodies, cloning the database, JSON comparisons, and returning the full database can become expensive as archives grow.  | Benchmark representative archives; introduce lightweight listings and targeted reads/writes when evidence justifies them. |
| High                          | Fixtures do not establish live-site or native-browser compatibility | Passing automation can coexist with failures on signed-in ChatGPT or native Arc/Edge UI.                                                     | Record verification by browser/version and distinguish native checks from Chromium simulation.                            |
| Medium                        | No automatic CI workflow is tracked in the repository               | Existing checks depend on someone running them consistently.                                                                                 | Add a CI gate for typecheck, tests, build, formatting, and selected browser scenarios.                                    |
| Medium                        | Documentation mixes current instructions and old release notes      | README references several historical installed/package versions, while the manifest is 3.0.3. Some instructions conflict on selection scope. | Separate current setup/support guidance from changelog material; derive release versions where possible.                  |
| Medium                        | Plain-text capture/export                                           | Rich tables, formulas, media, canvas content, and Markdown visuals are not faithfully preserved.                                             | Set accurate expectations and prioritize fidelity from actual user needs.                                                 |
| Medium                        | Font coverage is incomplete                                         | Many CJK characters and emoji become visible code-point tokens in PDFs.                                                                      | Explain coverage and evaluate additional fonts only for a demonstrated audience need.                                     |
| Medium                        | Local topics are heuristic                                          | Frequency-based keywords may be generic or biased toward the sampled early text.                                                             | Keep them editable or low prominence; avoid presenting them as semantic understanding.                                    |
| Medium                        | Temporary and regenerated conversation identity has edge cases      | Reloading a temporary chat can change identity; regenerated/branched turns may need more careful representation.                             | Add lifecycle and branch fixtures; communicate temporary-chat limits.                                                     |
| Medium                        | Main UI and worker operations handle broad state                    | Growing features can make orchestration and performance harder to reason about.                                                              | Refactor incrementally around concrete changes, preserving current behavior.                                              |

Additional engineering points worth addressing:

- The observer watches the document subtree, the content script polls navigation, the panel polls context, and writes broadcast invalidations. Measure their combined work during streaming and across multiple tabs.
- Source-highlight authorization checks the live source tab. Other content-script commands should receive a deliberate review of sender scope, allowed operations, and aggregate payload limits. Individual field validation does not bound total snapshot size. This is a review recommendation, not a demonstrated exploit.
- Initial legacy-data validation is shallow before transition code accesses nested fields. Add malformed-archive cases before introducing import or more migrations.
- Unresolved annotations should be visible as such, with their saved notes available and a repair path.
- A root project license and a tracked CI workflow were not found. Font licenses are included. Decide the intended code license and redistribution policy before inviting wider reuse.
- Accessibility has useful foundations such as labels and some keyboard handling, but a complete focus, contrast, screen-reader, and keyboard-only audit has not been established.

## 8. Verification performed for this review

Fresh checks used the existing installed dependencies and rebuilt the extension. This was not a clean-machine installation test.

| Check                                | Result                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                      | Passed: strict TypeScript, all **62 tests across 15 files**, and production builds.                                                                                 |
| `node scripts/smoke.mjs` after build | Passed: packaged Chromium workflow covering creation, reader highlights, notes, updates, persistence, themes, PDF text, pause/resume, finish, and another notebook. |
| `node scripts/notebook-ux.mjs`       | Passed: Home/Read/Highlights, personal overview, source-linked insights, annotation metadata and filtering, later-chapter navigation, and study PDF structure.      |
| `node scripts/source-highlights.mjs` | Passed: source-toolbar recovery, mouse and selection-change selection, replaced answer DOM, notes, notebook/PDF output, reload restoration, and clearing.           |
| `node scripts/acceptance.mjs`        | Passed: four complete messages in order in both downloaded PDFs, annotations/notes in the annotated export, and existing-tab reconnection.                          |
| `npm run format:check`               | Failed: Prettier reports formatting in `manifest.json`. Existing source formatting was not changed as part of this documentation task.                              |

Generated artifacts from older runs also exist, but their presence alone is not treated as fresh verification. Native Arc, Edge, and Firefox checks, the dedicated Persian browser script, and the Firefox add-on linter were not rerun for this review; multilingual unit tests were included in the passing suite.

These results do not establish current signed-in ChatGPT compatibility, native Edge/Arc behavior, store acceptance, Firefox signing, recovery from real browser-profile loss, security certification, or product-market fit.

## 9. Recommended product strategy

### Positioning

Use a focused promise: **“Keep the useful parts of your ChatGPT learning, with context, personal notes, and a study notebook you can revisit.”**

Start by testing this with people who already use ChatGPT repeatedly to learn: students, independent learners, and technical professionals studying a topic. Treat these as audience hypotheses. The repository contains no user research, acquisition numbers, retention data, or willingness-to-pay evidence that establishes a winning segment.

Choose one initial segment based on observed use. A focused learning workflow will give clearer feedback than simultaneously serving research teams, every AI platform, collaboration, and general knowledge management.

### The order of investment

1. **Earn trust:** reliable capture, honest capture status, safe persistence, and restorable data.
2. **Make revisiting worthwhile:** fast navigation, useful annotation retrieval, and clear source links.
3. **Validate repeat use:** observe whether users return to notebooks without prompting.
4. **Expand from demand:** add a second platform or optional services only when the core workflow is used repeatedly.

The code is a starting advantage; lasting value will depend on reliability and how effectively users recover ideas later. Treat DOM maintenance as an ongoing product responsibility.

### Distribution and commercial direction

Run a small, supported pilot before a broad launch. Provide a short walkthrough showing a real sequence: capture a learning conversation, save three ideas, add a personal note, then return to one idea later. Ask participants to report missing text and confusing lifecycle behavior as well as what they found useful.

Prepare public distribution only after release checks, privacy/support documentation, and packaging review. The repository provides local installation and packaging; it does not establish published store listings or an active distribution funnel.

Keep the core local workflow useful. Test willingness to pay before building billing. Potential paid directions include stronger export, advanced organization, or explicitly optional sync, but these are hypotheses. Cloud sync adds infrastructure, privacy, conflict resolution, deletion, and support obligations; introduce it only after recovery and repeat use are established.

## 10. Roadmap and acceptance criteria

The sequence below is a recommendation. Timing depends on team capacity; these are completion gates, not delivery promises.

### Phase 1: release reliability

**Objective:** know what was captured and prevent silent failures.

- Run signed-in checks for new, long, project-scoped, regenerated, and temporary conversations.
- Validate scrolling, scan cancellation, source selection, navigation, pause/resume, finish, extension updates, and browser restarts.
- Show explicit partial/failed capture states and avoid implying that a stable scan proves complete history.
- Add CI and resolve formatting drift.
- Consolidate current installation instructions and maintain a browser support matrix.

**Exit gate:** release checks have recorded outcomes for each advertised browser; known capture failures have regression fixtures; incomplete capture and storage errors are visible.

### Phase 2: data ownership and recovery

**Objective:** users can keep, restore, and remove their work.

- Export a versioned, structured archive preserving messages, anchors, notes, tags, bookmarks, overview, and metadata.
- Import with validation, preview, duplicate-ID policy, compatibility checks, and explicit behavior for active/paused state.
- Add notebook deletion with safe handling of lifecycle references.
- Explain storage location, uninstall consequences, privacy limits, and backup steps in the product.

**Exit gate:** a fresh profile can restore an exported archive with its content and annotations intact; failed imports preserve the existing archive; deletion does not leave invalid active references.

### Phase 3: repeat-use pilot

**Objective:** establish whether the notebook helps people return to useful knowledge.

- Recruit a small initial cohort, for example 10–20 people in one learning segment. This is a proposed pilot size.
- Observe first use and a later return session; ask what participants expected to find.
- Improve the largest observed friction in navigation, search, notes, or export.
- Consider cross-notebook search if retrieval across multiple notebooks becomes a repeated need.

**Exit gate:** participants independently revisit saved material, can explain its value, and identify fewer unresolved capture/retrieval blockers. Set numeric targets after collecting a baseline.

### Phase 4: measured expansion

**Objective:** extend a working habit without weakening trust.

- Choose the next AI platform from participant requests. Complete its extraction fixtures, permissions, validation, lifecycle tests, and release checks before advertising support.
- Improve rich-text/PDF fidelity where observed workflows require it.
- Add targeted database reads and lightweight notebook metadata when benchmarks show archive-wide costs are material.
- Evaluate optional summary generation or sync as separate services with clear consent and failure behavior.

**Exit gate:** a new capability meets the same capture, recovery, and regression expectations as the original workflow.

## 11. How to judge progress

Use a small set of operational and product signals. These are proposed measures, not existing telemetry or established baselines.

| Question                          | Suggested signal                                                                      | Collection approach                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Can a new user get value?         | Creates a notebook and saves a useful annotation                                      | Observe pilot onboarding or use an explicitly opt-in local study. |
| Does value persist?               | Returns later to read, search, or follow a saved source                               | Participant diary and follow-up observation.                      |
| Can capture be trusted?           | Missing/reordered-turn reports; fixture and live-check outcomes                       | Privacy-safe issue reports and release records.                   |
| Can work be recovered?            | Backup/restore round-trip success, including after migration                          | Automated recovery scenarios and fresh-profile checks.            |
| Does the archive stay responsive? | Capture latency, UI response, export duration, memory at representative archive sizes | Local benchmarks with synthetic content.                          |
| Is expansion justified?           | Repeated unmet workflow requests and demonstrated willingness to pay                  | Interviews and explicit product experiments.                      |

The implementation currently has no analytics. Do not quietly add conversation collection to measure these signals. Begin with consented research and synthetic reliability tests; any telemetry should have a defined purpose, minimal fields, and explicit user choice.

## 12. Decisions to make next

1. Select one initial learning audience and its most frequent revisit task.
2. Agree that restorable backups and visible capture limitations are release requirements.
3. Decide which browser targets can receive ongoing native verification and support.
4. Decide the project license, public distribution plan, support channel, and maintenance owner.
5. Keep AI summaries, additional platforms, sync, and billing behind evidence-based expansion gates.

The practical next milestone is a trustworthy local study notebook with a documented support boundary and a working recovery path. The existing architecture can support that milestone; the highest-value work is strengthening it and testing it with real learning habits.

## 13. Repository reading guide

- [README.md](README.md): setup, workflows, practical limits, historical feature notes, browser installation.
- [FIX_NOTES.md](FIX_NOTES.md): capture/export failure analysis and earlier verification history.
- [package.json](package.json), [manifest.json](manifest.json): current version, commands, permissions, hosts.
- [Background worker](src/background/serviceWorker.ts), [repository transitions](src/storage/repository.ts), [IndexedDB](src/storage/indexedDB.ts): persistence and lifecycle behavior.
- [Extractor](src/content/chatgpt/extractor.ts), [history scan](src/content/chatgpt/history.ts), [source highlighter](src/content/sourceHighlighter.ts): principal host-integration risks.
- [Notebook view](src/notebook/NotebookView.tsx), [local overview](src/knowledge/overview.ts): current knowledge workflow and heuristic behavior.
- [PDF exporter](src/pdf/notebookExporter.ts), [bidirectional layout](src/pdf/bidirectional.ts): export implementation and multilingual handling.
- [Tests](tests/), [browser scripts](scripts/): regression coverage and release-validation tools.
