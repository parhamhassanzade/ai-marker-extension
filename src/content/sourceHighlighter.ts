import { v4 as uuid } from 'uuid';
import { snapshotOf } from '../adapters';
import { storage } from '../storage/storage';
import { conversationKey } from '../storage/repository';
import type { AIPlatformAdapter, Database, Highlight as SavedHighlight } from '../types';
import {
  contentOf,
  messageContainers,
  messageId,
  cleanMessageText,
  UI_SELECTOR,
} from './chatgpt/extractor';
import { isHidden } from './chatgpt/detector';
import { COLORS, highlightSegments } from './highlighter';
import { createToolbar } from './toolbar';

interface Character {
  node: Text;
  offset: number;
  canonical: number;
}
// Align real text nodes with the parser's canonical text. Whitespace and synthetic
// list/table separators can differ, so match whole non-whitespace text-node runs.
// This preserves occurrence identity even when the same sentence appears twice.
export function sourceTextMap(root: HTMLElement, text: string): Character[] {
  const positions: number[] = [];
  let compact = '';
  for (let i = 0; i < text.length; i++)
    if (!/\s/.test(text[i]!)) {
      compact += text[i];
      positions.push(i);
    }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const result: Character[] = [];
  let cursor = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest(UI_SELECTOR) || isHidden(parent)) continue;
    if (
      parent
        .closest('h2,h3,h4,h5,h6')
        ?.textContent?.match(/^(you said|chatgpt said|user|assistant)\s*:?$/i)
    )
      continue;
    const offsets: number[] = [];
    let value = '';
    for (let i = 0; i < (node.textContent?.length ?? 0); i++)
      if (!/\s/.test(node.textContent![i]!)) {
        value += node.textContent![i];
        offsets.push(i);
      }
    if (!value) continue;
    const start = compact.indexOf(value, cursor);
    if (start < 0) continue;
    offsets.forEach((offset, index) =>
      result.push({ node: node as Text, offset, canonical: positions[start + index]! }),
    );
    cursor = start + value.length;
  }
  return result;
}
export function sourceRange(map: Character[], start: number, end: number): Range | undefined {
  const chars = map.filter((char) => char.canonical >= start && char.canonical < end);
  if (!chars.length) return;
  const first = chars[0]!;
  const last = chars.at(-1)!;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}
export function startSourceHighlighter(adapter: AIPlatformAdapter): () => void {
  const toolbar = createToolbar();
  const style = document.createElement('style');
  style.textContent = Object.entries(COLORS)
    .map(
      ([color, value]) =>
        `::highlight(ai-notebook-${color}) { background-color: ${value}; color: #17202a; }`,
    )
    .join('\n');
  document.documentElement.append(style);
  let db: Database | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const names = ['yellow', 'green', 'red'] as const;
  function paint() {
    if (disposed) return;
    const key = conversationKey({
      platform: adapter.platform,
      conversationId: adapter.getConversationId(),
    });
    const notebook =
      db?.notebooks.find((n) => n.id === db?.activeByConversation[key]) ??
      db?.notebooks.filter((n) => conversationKey(n) === key).at(-1);
    const ranges = { yellow: [] as Range[], green: [] as Range[], red: [] as Range[] };
    messageContainers().forEach(({ element, role, turn }, index) => {
      const id = messageId(element, role, turn, index);
      const root = contentOf(element);
      const text = cleanMessageText(root);
      const highlights = notebook?.highlights.filter((h) => h.messageId === id) ?? [];
      if (!highlights.length) return;
      const map = sourceTextMap(root, text);
      for (const segment of highlightSegments(text, highlights)) {
        const highlight = segment.highlights.at(-1);
        if (!highlight) continue;
        const range = sourceRange(map, segment.start, segment.end);
        if (range) ranges[highlight.color].push(range);
      }
    });
    // CSS Highlight ranges do not wrap or replace React-owned ChatGPT nodes.
    for (const color of names)
      CSS.highlights.set(`ai-notebook-${color}`, new Highlight(...ranges[color]));
  }
  async function refresh() {
    try {
      db = await storage.listNotebooks();
      paint();
    } catch {
      /* The old context can be invalidated when the extension is reloaded. */
    }
  }
  function schedulePaint() {
    clearTimeout(timer);
    timer = setTimeout(paint, 150);
  }
  function select(event?: Event) {
    if (event?.composedPath().includes(toolbar.host)) return;
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
      toolbar.hide();
      return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    const containers = messageContainers();
    const index = containers.findIndex(
      ({ element }) =>
        element.contains(range.startContainer) && element.contains(range.endContainer),
    );
    const container = containers[index];
    if (!container) {
      toolbar.hide();
      return;
    }
    const root = contentOf(container.element);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const text = cleanMessageText(root);
    const map = sourceTextMap(root, text);
    const selected = map.filter(
      (char) =>
        range.comparePoint(char.node, char.offset) === 0 &&
        range.comparePoint(char.node, char.offset + 1) === 0,
    );
    if (!selected.length) return;
    const start = selected[0]!.canonical;
    const end = selected.at(-1)!.canonical + 1;
    if (end - start > 50_000) return;
    const snapshot = snapshotOf(adapter);
    const id = messageId(container.element, container.role, container.turn, index);
    toolbar.show(range.getBoundingClientRect(), {
      cancel: () => selection.removeAllRanges(),
      save: async (color, note) => {
        if (
          !range.startContainer.isConnected ||
          adapter.getConversationId() !== snapshot.conversationId
        )
          throw new Error('The conversation changed. Select the passage again.');
        const highlight: SavedHighlight = {
          id: uuid(),
          platform: snapshot.platform,
          conversationId: snapshot.conversationId,
          website: snapshot.website,
          messageId: id,
          text: text.slice(start, end),
          color,
          note,
          createdAt: new Date().toISOString(),
          anchor: {
            start,
            end,
            prefix: text.slice(Math.max(0, start - 40), start),
            suffix: text.slice(end, end + 40),
          },
        };
        db = await storage.saveSourceHighlight(snapshot, highlight);
        paint();
        selection.removeAllRanges();
        toolbar.hide();
      },
    });
  }
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.shiftKey || event.key.startsWith('Arrow')) select(event);
  };
  document.addEventListener('pointerup', select);
  document.addEventListener('keyup', onKeyUp);
  const observer = new MutationObserver(schedulePaint);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const urlTimer = setInterval(schedulePaint, 800);
  const unsubscribe = storage.subscribe(() => void refresh());
  void refresh();
  return () => {
    disposed = true;
    clearTimeout(timer);
    clearInterval(urlTimer);
    observer.disconnect();
    document.removeEventListener('pointerup', select);
    document.removeEventListener('keyup', onKeyUp);
    toolbar.destroy();
    style.remove();
    names.forEach((color) => CSS.highlights.delete(`ai-notebook-${color}`));
    try {
      unsubscribe();
    } catch {
      /* Invalidated extension context. */
    }
  };
}
