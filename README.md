# AI Notebook

AI Notebook **3.0.3** is a desktop browser extension that turns captured ChatGPT conversations into chaptered study notebooks with highlights, notes, tags, bookmarks, and PDF export. Everything stays local to your browser profile; there are no analytics, accounts, model calls, or cloud sync.

## Build and install

Use Node.js **22.12+ in the 22 LTS line, or 24+**, and npm:

```sh
npm ci
npm run build
```

| Browser                                    | Load directory   | Notebook interface                         |
| ------------------------------------------ | ---------------- | ------------------------------------------ |
| Chrome 116+ / Edge with the side-panel API | `dist/`          | Native side panel                          |
| Arc desktop                                | `build/arc/`     | Toolbar popup and separate notebook window |
| Firefox desktop 140+                       | `build/firefox/` | Native sidebar                             |

ChatGPT is the only enabled AI platform. Supported hosts are `https://chatgpt.com` and `https://chat.openai.com`. Mobile browsers are not supported.

### Chrome and Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select `dist/`.
3. Pin **AI Notebook**, open a ChatGPT conversation, and click the extension icon.
4. Click **Create notebook** to capture the available conversation.

### Arc

1. Open `arc://extensions`, enable **Developer mode**, and load `build/arc/` unpacked.
2. Open ChatGPT and click AI Notebook in the extensions menu.
3. Use **Create notebook** in the popup. Choose **Keep notebook open** for a separate window connected to the originating browser window. A notebook-tab fallback is used if windows are rejected.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `build/firefox/manifest.json`.
3. Open ChatGPT and click AI Notebook to open its sidebar. Grant ChatGPT access if asked.

Temporary add-ons are removed when Firefox restarts. The generated XPI is unsigned; permanent distribution requires signing. Reinstalling a temporary add-on may not preserve its data, so avoid relying on it for your only copy of important notes.

### Updating and packaging

After a rebuild, reload the extension in its extension manager and confirm **3.0.3**. The notebook reconnects to existing tabs and replaces outdated content scripts when possible. Refresh ChatGPT if needed; rebuilding files alone does not reload an installed worker.

`npm run package` creates versioned Chrome/Arc ZIPs and a Firefox XPI in `packages/`. Use each browser's own build directory.

## Use your notebook

1. Open a saved conversation or start a new ChatGPT chat. Visiting alone does not create a notebook.
2. Click **Create notebook**. Capture scans backward through available rendered history and restores your scroll position. **Stop history scan** cancels scanning; hidden or collapsed content may need to be opened manually.
3. Browse **Home**, **Read**, and **Highlights**:
   - **Home:** edit your personal overview, explore topics and chapters, or jump from a saved insight to its source. Topics use local keywords/tags; insights come from highlights, with bookmarks prioritized. There is no generated AI summary.
   - **Read:** read captured questions and answers as chapters. The first 20 chapters render initially; **Read next 20 chapters** reveals more. Source jumps load later chapters as needed.
   - **Highlights:** search the current notebook's selected text, notes, and tags; filter by tag or bookmark; edit notes/tags and return to the source passage.
4. Keep chatting while updates are active. New turns and streamed text update the same notebook.
5. **Pause updates** stops automatic capture. **Resume updates** captures available turns added while paused. **Finish** keeps the notebook readable/editable and makes later activation start another notebook. **New notebook for this conversation** finishes the active one and starts another.
6. Rename the notebook by editing its title and saving with Enter or the check button. Use the notebook selector to revisit older notebooks.
7. **Save study PDF** exports all captured chapters, including those not yet displayed, along with overview, highlights, notes, tags, bookmarks, contents links, and page numbers. The active conversation is refreshed first. Empty notebooks cannot be exported.
8. Remove individual highlights or use **Clear highlights** and confirm. Full conversation text remains. The theme button saves a local light/dark preference.

### Highlight selection scope

The two selection surfaces have different rules, matching the implementation:

- **Original ChatGPT page:** select text within one detected **user question or assistant answer**. The floating toolbar works with the notebook closed. The first save can create a notebook. Adding annotations to a paused/finished notebook does not restart automatic capture.
- **Notebook reader:** select text within one **assistant answer**. User questions cannot be highlighted here. Choose a persistent yellow/green/red color for immediate saving, or **Select text** for the floating toolbar and a note.

The toolbar offers yellow **Highlight**, green **Definition**, red **Important**, **Add Note**, and **Cancel**. **Save note + highlight** uses yellow. Selection can cross formatting and paragraphs inside one message, but cannot cross messages and is capped at 50,000 characters. Shift-based keyboard selection and Escape dismissal are supported.

Annotations store the selected quote, message ID, offsets, and surrounding context. Colors restore on the source page after reload and appear in the notebook and PDF.

## Privacy and known limits

- Captured text, annotations, and session state are stored in IndexedDB; small preferences are in browser local storage. The extension does not encrypt this data. Uninstalling removes it; browser-profile loss or user-cleared storage can also remove it. Restorable backup/import and notebook deletion are not implemented yet. A PDF preserves readable output, but cannot restore an editable notebook.
- Existing `aiMarker.v1` archives migrate on first access. The legacy blob is removed only after a successful IndexedDB commit, and migrated capture starts paused.
- Permissions are `storage`, `activeTab`, `sidePanel` (Chrome/Edge), and `scripting`, with host access restricted to the two ChatGPT hosts. No broad `tabs` or `downloads` permission is requested.
- “Full conversation” means **captured text**, not guaranteed server history. The scan is bounded to 60 steps; hidden branches, unexposed history, collapsed content, images, canvas documents, and other media cannot be recovered automatically. A stable scroll position is not proof of complete history.
- Extraction depends on ChatGPT's changing page structure. Automated browser tests use realistic fixtures, not signed-in ChatGPT. Native Edge/Arc UI, signed-in ChatGPT, and Firefox releases need manual release checks. The Arc script tests its build in Chromium, not native Arc.
- Stable platform IDs are preferred. Positional IDs, regenerated answers, branches, and virtualized layouts have identity limitations. Ambiguous highlights can remain unpainted; saved notes are retained.
- Temporary chats use an in-page UUID until matching turns establish a stable URL. Reloading an unsaved temporary chat can create a different notebook identity. Normal saved conversations preserve lifecycle state across reloads.
- PDFs preserve text, code indentation, and line breaks. Rich Markdown appearance, formulas, media, and rich tables are not reproduced visually. Bundled fonts support Persian/Arabic, Latin, Greek, and Cyrillic; unsupported characters, including most CJK and emoji, become `[U+CODEPOINT]` tokens. Copy/search of joined Arabic glyphs varies by PDF reader.
- IndexedDB remains subject to browser storage quota and memory/messaging limits. Archives are local to each browser/profile, with no cross-browser synchronization.
- Once the extension page has a saved notebook, it requests persistent storage to reduce automatic eviction risk. This also covers older notebooks and notebooks first created by a source-page highlight when you next open the notebook. The browser can deny the request or lack support; capture and saving still work. The request is attempted once per notebook-page session. Persistence does not protect against uninstall, user-cleared data, or profile loss, and is not a backup. The extension does not request `unlimitedStorage`.

For development commands and release checks, see [Development](docs/development.md). Historical version notes are in [CHANGELOG.md](CHANGELOG.md); earlier capture/export analysis is in [FIX_NOTES.md](FIX_NOTES.md). [LICENSE](LICENSE) currently uses MIT as an owner-reviewable placeholder; bundled fonts retain their separate licenses.
