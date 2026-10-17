# Rich content implementation

## Slice A: storage and capture

Assistant messages may contain `contentVersion: 1` and `content: { blocks, gaps }`. Both fields are optional together: a message without them is a legacy plain-text message. User messages remain plain text. IndexedDB's object-store layout and database version remain unchanged; this is an additive record-format extension. The pre-change fixture is exercised through IndexedDB reopening, PDF fallback, the background worker's legacy migration, and the backup codec.

Blocks cover headings 1–6, paragraphs, nested ordered/unordered lists with starting numbers, tables with header-row count and alignment, language-labelled code, blockquotes, and horizontal rules. Inline nodes cover styled text (bold, italic, strike, code, links), explicit line breaks, math with LaTeX source and display mode, and unsupported-media placeholders. No raw HTML or DOM objects are persisted. Link schemes are restricted to HTTP, HTTPS, and mailto; other links retain their text without link marks. Relative links are also plain text.

`message.text` uses the exact pre-change serialization rules. The serializer now carries DOM provenance through those rules; it does not search for first occurrences of text. Each text run has mappings from local run offsets (`textStart`, `textEnd`) to canonical message offsets (`start`, `end`), all in UTF-16 code units as used by existing highlights. Canonical text supplied by structure (list markers, cell separators, whitespace, or omitted legacy wrappers) is covered by `gaps`. Validation requires mapped ranges and gaps to partition the canonical string exactly once, and verifies that every mapped substring matches byte for byte. Highlight quotes, offsets, context, and overlap policy are unchanged.

The worker validates the content version, node types, properties, link schemes, bounds, mapping consistency, depth, and budgets before accepting commands. Limits are 32 nesting levels, 20,000 model nodes, 40,000 mapping segments, 100,000 characters per LaTeX source, and 4,000,000 model text characters in total. Capture also bounds model traversal. Text-only messages retain existing payload limits.

Existing plain assistant messages are kept in their saved representation when a rich snapshot arrives through sync, resume, activation, or source annotation. Their saved text is not overwritten by that first rich snapshot, including when a source turn was edited. New turns receive structured content and continue to update normally. An unchanged rich message is preserved if an older content script supplies only plain text; a changed plain snapshot discards stale rich content. The explicit source-open recapture action belongs to slice D and is not implemented here.

### Backup format contract

`src/storage/backup.ts` defines a pure JSON encoder/parser for:

```text
{ formatVersion: 1, appVersion, exportedAt, database }
```

The complete notebook records, lifecycle metadata, `contentVersion`, AST, mappings, annotations, notes, tags, bookmarks, and overviews round-trip without conversion. An optional notebook ID restricts export and lifecycle references to that notebook. Parsing rejects unknown format/content versions, malformed content, orphaned highlights, duplicate notebook/message/highlight IDs, invalid active references, and files above 64 MB. A single-notebook export is available when a whole archive would exceed the file limit.

This codec performs no writes. It does **not** provide a backup UI, duplicate-resolution policy, import preview, or an import transaction. A future import command must validate with this codec, apply the chosen duplicate policy, pause imported notebooks, and commit through the background worker. Merely parsing a backup must not activate it or write to storage.

### Tests and fixture provenance

`tests/helpers/legacyExtractor.ts` is frozen from 3.0.3 and retained as an independent compatibility reference. The old semantic and observed search-unit fixtures and both rich fixtures run through old/new extraction with exact text/byte assertions. The kitchen-sink fixtures are synthetic examples built around existing observed ChatGPT wrapper/role patterns, not new signed-in recordings. They contain all requested elements and English/Persian variants. Additional tests cover source immutability, repeated passages, styled/list/table/code anchors, pre-wrap whitespace, placeholders, invalid content, versioned JSON round trips, legacy migration, and failed atomic writes.

Slice A verification: `npm run check` passed with 105 tests across 18 files, typechecking, and all production builds; `npm run format:check` passed. Smoke, notebook UX, source highlights, and PDF acceptance browser scripts passed. A parallel source-highlights run timed out clicking the selection toolbar; an earlier run and the isolated final retry passed. This intermittent toolbar timing failure is recorded rather than treated as a clean first-pass result. Signed-in ChatGPT and native Edge/Arc/Firefox were not checked.

## Later slices

- B: render the model in the reader and translate selections using the mappings.
- C: structured PDF layout, used-font registration, per-character fallback, responsiveness/progress, 300-turn before/after benchmarks, font/package/PDF size reporting, and page PNGs for approval.
- D: Markdown export, source-open explicit recapture, acceptance-script extensions, and final user documentation.

Reader and PDF output remain plain text in slice A; placeholder and LaTeX nodes become visible when those renderers are implemented. No fonts, PDF layout, or export behavior have been changed yet.

The installed jsPDF 4.2.1 Identity-H TTF embedding path calls `font.metadata.subset.encode(font.metadata.glyIdsUsed, 1)`, confirming glyph subsetting. This is distinct from registering only the document's used font variants, which must also be implemented in C. Bundled font bytes still increase extension size even when PDFs embed subsets. The planned math fallback is visible LaTeX source; Arabic italic remains upright, as approved.
