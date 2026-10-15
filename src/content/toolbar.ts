import type { HighlightColor } from '../types';
interface Actions {
  save(color: HighlightColor, note: string): Promise<void>;
  cancel(): void;
}
export function createToolbar() {
  const host = document.createElement('div');
  host.id = 'ai-marker-toolbar';
  host.style.cssText = 'position:fixed;z-index:2147483647;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host{color-scheme:light dark}*{box-sizing:border-box} .panel{font:13px/1.5 system-ui,sans-serif;background:#fff;color:#242820;border:1px solid #dedfd6;border-radius:14px;padding:8px;box-shadow:0 8px 32px #0003;max-width:calc(100vw - 16px)}.row{display:flex;gap:4px;flex-wrap:wrap}button{font:inherit;cursor:pointer;border:0;background:transparent;color:inherit;padding:7px;border-radius:8px}button:hover,button:focus-visible{background:#efefe7;outline:2px solid #73895f}button:disabled{opacity:.5;cursor:wait}textarea{display:block;width:100%;min-width:230px;margin:8px 0;padding:8px;border:1px solid #ccc;border-radius:8px;font:inherit;background:inherit;color:inherit} .note{display:none}.status{max-width:340px;padding:5px} @media(prefers-color-scheme:dark){.panel{background:#252922;color:#f1f1e9;border-color:#43483e}button:hover,button:focus-visible{background:#3b4234}}`;
  shadow.append(style);
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Save selection to AI Notebook');
  shadow.append(panel);
  const row = document.createElement('div');
  row.className = 'row';
  panel.append(row);
  let actions: Actions | undefined;
  let busy = false;
  let anchorRect: DOMRect | undefined;
  function position() {
    if (!anchorRect) return;
    const { width, height } = host.getBoundingClientRect();
    const top = anchorRect.top > height + 12 ? anchorRect.top - height - 8 : anchorRect.bottom + 8;
    host.style.left = `${Math.max(8, Math.min(anchorRect.left, innerWidth - width - 8))}px`;
    host.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  }
  const noteBox = document.createElement('div');
  noteBox.className = 'note';
  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Add your note…';
  textarea.maxLength = 5000;
  textarea.setAttribute('aria-label', 'Highlight note');
  noteBox.append(textarea);
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  const buttons: HTMLButtonElement[] = [];
  function button(label: string, handler: () => void, parent = row) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', handler);
    parent.append(el);
    buttons.push(el);
    return el;
  }
  async function save(color: HighlightColor) {
    if (busy || !actions) return;
    busy = true;
    buttons.forEach((b) => (b.disabled = true));
    try {
      await actions.save(color, textarea.value.trim());
      hide();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Unable to save highlight.';
      status.hidden = false;
      position();
    } finally {
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  button('🟡 Highlight', () => {
    void save('yellow');
  });
  button('🟢 Definition', () => {
    void save('green');
  });
  button('🔴 Important', () => {
    void save('red');
  });
  button('📝 Add Note', () => {
    noteBox.style.display = 'block';
    position();
    textarea.focus();
  });
  button('✕ Cancel', () => {
    actions?.cancel();
    hide();
  });
  button(
    'Save note + highlight',
    () => {
      void save('yellow');
    },
    noteBox,
  );
  panel.append(noteBox, status);
  host.addEventListener('pointerdown', (event) => event.stopPropagation());
  row.addEventListener('pointerdown', (event) => event.preventDefault());
  shadow.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      actions?.cancel();
      hide();
    }
  });
  document.documentElement.append(host);
  function hide() {
    host.style.display = 'none';
  }
  return {
    destroy: () => host.remove(),
    host,
    hide,
    show(rect: DOMRect, nextActions: Actions) {
      if (busy) return;
      // A host-page rerender can remove extension UI without unloading this script.
      if (!host.isConnected) document.documentElement.append(host);
      actions = nextActions;
      textarea.value = '';
      noteBox.style.display = 'none';
      status.hidden = true;
      host.style.display = 'block';
      anchorRect = rect;
      position();
    },
  };
}
