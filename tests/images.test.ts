import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { jsPDF } from 'jspdf';
import { strFromU8, unzlibSync } from 'fflate';
import { ChatGPTAdapter } from '../src/adapters/ChatGPTAdapter';
import { projectMessageText } from '../src/content/chatgpt/projection';
import { detectImages } from '../src/content/images/detect';
import { createImageScanner } from '../src/content/images/scanner';
import { anchorSelection, resolveAnchor } from '../src/content/highlighter';
import { sha256Hex, toBase64 } from '../src/images/process';
import { storedImageUrl, type ImageRecord } from '../src/images/types';
import { IMAGE_SETTINGS_KEY } from '../src/images/settings';
import { createNotebookPdf, type PdfImage } from '../src/pdf/notebookExporter';
import { decodeNotebookArchive, encodeNotebookArchive } from '../src/storage/archive';
import { notebookMarkdown } from '../src/export/markdown';
import { mergeImport } from '../src/storage/repository';
import { isMessageContent } from '../src/content/model/validation';
import type { Database, Notebook } from '../src/types';

const fixture = readFileSync('tests/fixtures/chatgpt-images.html', 'utf8');
const jpeg = new Uint8Array(readFileSync('tests/fixtures/images/landscape.jpg'));
const tall = new Uint8Array(readFileSync('tests/fixtures/images/tall.jpg'));
const png = new Uint8Array(readFileSync('tests/fixtures/images/transparent.png'));
function load(html = fixture) {
  document.documentElement.innerHTML = html;
  history.replaceState({}, '', '/c/garden');
}
function detected() {
  const adapter = new ChatGPTAdapter();
  return adapter.sourceMessages().map((message) => ({
    ...message,
    images: detectImages(message.element, message.role, projectMessageText(message.element, true)),
  }));
}

describe('image detection (synthetic ChatGPT markup)', () => {
  it('finds uploaded, generated, and carousel images and skips icons', () => {
    load();
    const [q1, a1, q2, a2] = detected();
    expect(q1!.images.map((i) => [i.source, i.index, i.offset, i.alt])).toEqual([
      ['uploaded', 0, 0, 'Uploaded image'],
    ]);
    expect(a1!.images.map((i) => [i.source, i.alt])).toEqual([
      ['generated', 'Garden layout sketch'],
    ]);
    expect(q2!.images).toEqual([]);
    expect(a2!.images.map((i) => [i.source, i.pageUrl])).toEqual([
      ['web', 'https://garden.example/cherry'],
      ['web', 'https://garden.example/beefsteak'],
    ]);
  });
  it('places an image at the canonical offset after the preceding text', () => {
    load();
    const messages = new ChatGPTAdapter().extractMessages();
    const offset = detected()[1]!.images[0]!.offset;
    expect(messages[1]!.text.slice(0, offset)).toBe('Here is a sketch of the garden layout.');
    expect(messages[1]!.text.slice(offset).trimStart()).toMatch(/^The beds face south/);
  });
  it('leaves message.text byte-identical and adds image nodes to the content model', () => {
    load();
    const withImages = new ChatGPTAdapter().extractMessages();
    // An empty element keeps neighbouring text nodes separate, as the image did.
    load(fixture.replace(/<img\b[^>]*>/g, '<span></span>'));
    const without = new ChatGPTAdapter().extractMessages();
    expect(withImages.map((m) => m.text)).toEqual(without.map((m) => m.text));
    const a1 = withImages[1]!;
    expect(isMessageContent(a1.content, a1.text)).toBe(true);
    expect(JSON.stringify(a1.content)).toContain(
      '{"type":"image","index":0,"alt":"Garden layout sketch"}',
    );
  });
  it('strips expiring signatures from stored URLs', () => {
    expect(storedImageUrl('https://files.oaiusercontent.com/file-1/a.jpg?se=2026&sig=SECRET')).toBe(
      'https://files.oaiusercontent.com/file-1/a.jpg',
    );
    expect(
      storedImageUrl('https://chatgpt.com/backend-api/estuary/content?id=file-gen1&ts=1&sig=X'),
    ).toBe('https://chatgpt.com/backend-api/estuary/content?id=file-gen1');
  });
});

describe('image scanner', () => {
  afterEach(() => vi.unstubAllGlobals());
  function scanner(responses: Record<string, Response | Error>, records: unknown[] = []) {
    load();
    // jsdom does not load images; treat fixture images as loaded.
    for (const image of document.querySelectorAll('img'))
      Object.defineProperty(image, 'complete', { value: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const response = responses[Object.keys(responses).find((key) => url.includes(key)) ?? ''];
        if (!response) throw new TypeError('Failed to fetch');
        if (response instanceof Error) throw response;
        return response;
      }),
    );
    const sent: Record<string, unknown>[] = [];
    const send = vi.fn(async (message: unknown) => {
      const value = message as Record<string, unknown>;
      if (value.type === 'imageState')
        return {
          ok: true,
          notebookId: 'n',
          messageIds: ['q1', 'a1', 'q2', 'a2'],
          settings: { saveImages: true, includeWebImages: false, prompted: true },
          records,
        };
      sent.push(value);
      return {
        ok: true,
        status: 'data' in value ? 'saved' : value.status ? value.status : 'failed',
      };
    });
    const process = vi.fn(async () => ({
      hash: 'a'.repeat(64),
      mime: 'image/jpeg' as const,
      width: 320,
      height: 200,
      bytes: jpeg,
    }));
    return { scan: createImageScanner(new ChatGPTAdapter(), send, process).scan, sent };
  }
  const ok = () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  it('fetches in the page first, falls back to the worker for CDN images, and keeps web placeholders', async () => {
    const { scan, sent } = scanner({ 'chatgpt.com/backend-api': ok() });
    await scan();
    const byMessage = Object.fromEntries(
      sent.map((s) => [`${s.messageId}:${(s.image as { index: number }).index}`, s]),
    );
    expect(byMessage['a1:0']).toMatchObject({ data: { mime: 'image/jpeg' } });
    // CORS-blocked CDN fetch: the worker fetches with its optional host grant.
    expect(byMessage['q1:0']).toMatchObject({
      fetchUrl: expect.stringContaining('files.oaiusercontent.com'),
    });
    expect(byMessage['a2:0']).toMatchObject({ status: 'placeholder' });
    expect(byMessage['a2:1']).toMatchObject({ status: 'placeholder' });
    expect(JSON.stringify(sent.map((s) => s.image))).not.toContain('SECRET');
  });
  it('records an expired signed link as a failure with a clear reason', async () => {
    const { scan, sent } = scanner({
      'chatgpt.com/backend-api': new Response('expired', { status: 403 }),
    });
    await scan();
    expect(sent.find((s) => s.messageId === 'a1')).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/expired \(HTTP 403\)/),
    });
  });
  it('skips images already saved under the same URL', async () => {
    const { scan, sent } = scanner({ 'chatgpt.com/backend-api': ok() }, [
      {
        messageId: 'a1',
        index: 0,
        status: 'saved',
        url: storedImageUrl(
          'https://chatgpt.com/backend-api/estuary/content?id=file-gen1&ts=1&sig=SECRET',
        ),
      },
    ]);
    await scan();
    expect(sent.some((s) => s.messageId === 'a1')).toBe(false);
  });
});

const notebook = (id = 'n'): Notebook => ({
  id,
  title: 'Garden photos',
  conversationTitle: 'Garden photos',
  platform: 'ChatGPT',
  conversationId: 'garden',
  website: 'https://chatgpt.com/c/garden',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  messages: [
    { id: 'q1', role: 'user', text: 'What is in this garden photo?' },
    {
      id: 'a1',
      role: 'assistant',
      text: 'Here is a sketch of the garden layout.\n\nThe beds face south for more sun.',
    },
  ],
  highlights: [
    {
      id: 'h1',
      platform: 'ChatGPT',
      conversationId: 'garden',
      website: 'https://chatgpt.com/c/garden',
      messageId: 'a1',
      text: 'face south',
      color: 'green',
      note: 'Sun',
      createdAt: '2026-10-01T00:00:00.000Z',
      anchor: { start: 49, end: 59, prefix: '', suffix: '' },
    },
  ],
});
async function saved(
  bytes: Uint8Array,
  fields: Partial<ImageRecord> & Pick<ImageRecord, 'messageId' | 'index'>,
): Promise<ImageRecord> {
  return {
    notebookId: 'n',
    offset: 38,
    alt: 'Garden layout sketch',
    url: 'https://chatgpt.com/backend-api/estuary/content?id=file-gen1',
    source: 'generated',
    status: 'saved',
    hash: await sha256Hex(bytes),
    mime: 'image/jpeg',
    width: 320,
    height: 200,
    bytes: bytes.length,
    capturedAt: '2026-10-01T00:00:00.000Z',
    ...fields,
  };
}

describe('image storage', () => {
  let database: typeof import('../src/storage/indexedDB');
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    database = await import('../src/storage/indexedDB');
  });
  afterEach(async () => {
    await database.closeDatabase();
    vi.unstubAllGlobals();
  });
  const blob = async (bytes: Uint8Array) => ({
    hash: await sha256Hex(bytes),
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
    mime: 'image/jpeg' as const,
    bytes: bytes.length,
  });
  it('deduplicates identical images by content hash and removes the last orphan', async () => {
    const first = await saved(jpeg, { messageId: 'a1', index: 0 });
    const second = await saved(jpeg, { messageId: 'q1', index: 0, offset: 0 });
    await database.putImage(first, await blob(jpeg));
    await database.putImage(second, await blob(jpeg));
    expect(await database.listImages('n')).toHaveLength(2);
    expect(await database.getImageBlob(first.hash!)).toBeDefined();
    await database.removeImage(first);
    expect(await database.getImageBlob(first.hash!)).toBeDefined();
    await database.removeImage(second);
    expect(await database.getImageBlob(first.hash!)).toBeUndefined();
    // Removal leaves a tombstone so background capture does not refetch it.
    expect((await database.listImages('n')).map((r) => r.status)).toEqual(['removed', 'removed']);
  });
  it('refuses a saved record without its blob', async () => {
    await expect(
      database.putImage(await saved(jpeg, { messageId: 'a1', index: 0 })),
    ).rejects.toThrow(/missing/);
  });
  it('deletes a notebook’s images and blobs with the notebook', async () => {
    const db: Database = {
      version: 1,
      notebooks: [notebook('n'), notebook('m')],
      activeByConversation: {},
      pausedConversations: [],
    };
    await database.writeDatabase(db);
    await database.putImage(await saved(jpeg, { messageId: 'a1', index: 0 }), await blob(jpeg));
    await database.putImage(
      await saved(png, { notebookId: 'm', messageId: 'a1', index: 0, mime: 'image/png' }),
      { ...(await blob(png)), mime: 'image/png' },
    );
    const { transition } = await import('../src/storage/repository');
    await database.writeDatabase(transition(db, { type: 'delete', id: 'n' }), db);
    expect(await database.listImages('n')).toEqual([]);
    expect(await database.getImageBlob(await sha256Hex(jpeg))).toBeUndefined();
    expect(await database.listImages('m')).toHaveLength(1);
    expect(await database.getImageBlob(await sha256Hex(png))).toBeDefined();
  });
});

describe('worker image commands', () => {
  let local: Record<string, unknown>;
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    local = { [IMAGE_SETTINGS_KEY]: { saveImages: true, includeWebImages: false, prompted: true } };
    vi.stubGlobal('chrome', {
      runtime: { id: 'x', getURL: (path: string) => `chrome-extension://x${path}` },
      storage: { local: { get: async () => structuredClone(local) } },
      permissions: { contains: async () => false },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const db: Database = {
    version: 1,
    notebooks: [notebook()],
    activeByConversation: { 'ChatGPT:garden': 'n' },
    pausedConversations: [],
  };
  const image = {
    index: 0,
    offset: 38,
    alt: 'Garden layout sketch',
    url: 'https://chatgpt.com/backend-api/estuary/content?id=file-gen1',
    source: 'generated' as const,
  };
  const sender = {
    id: 'x',
    frameId: 0,
    url: 'https://chatgpt.com/c/garden',
    tab: { id: 1, url: 'https://chatgpt.com/c/garden' } as chrome.tabs.Tab,
  };
  it('verifies the hash, stores the blob, and rejects other conversations', async () => {
    const images = await import('../src/background/images');
    const { listImages, closeDatabase } = await import('../src/storage/indexedDB');
    const command = {
      type: 'storeImage' as const,
      notebookId: 'n',
      messageId: 'a1',
      image,
      data: {
        base64: toBase64(jpeg),
        mime: 'image/jpeg' as const,
        hash: await sha256Hex(jpeg),
        width: 320,
        height: 200,
      },
    };
    expect(images.isImageCommand(command)).toBe(true);
    const record = await images.commitImage(
      db,
      command,
      sender,
      await images.prepareImage(command),
    );
    expect(record).toMatchObject({ status: 'saved', bytes: jpeg.length });
    expect(await listImages('n')).toHaveLength(1);
    const other = {
      ...sender,
      tab: { id: 2, url: 'https://chatgpt.com/c/other' } as chrome.tabs.Tab,
    };
    await expect(
      images.commitImage(db, command, other, await images.prepareImage(command)),
    ).rejects.toThrow(/no longer belongs/);
    const corrupted = { ...command, data: { ...command.data, hash: 'b'.repeat(64) } };
    expect((await images.prepareImage(corrupted)).record).toMatchObject({
      status: 'failed',
      error: 'Image data was corrupted.',
    });
    await closeDatabase();
  });
  it('keeps web images as placeholders unless the user opts in', async () => {
    const images = await import('../src/background/images');
    const command = {
      type: 'storeImage' as const,
      notebookId: 'n',
      messageId: 'a1',
      image: { ...image, source: 'web' as const, pageUrl: 'https://garden.example/cherry' },
      data: {
        base64: toBase64(jpeg),
        mime: 'image/jpeg' as const,
        hash: await sha256Hex(jpeg),
        width: 320,
        height: 200,
      },
    };
    expect((await images.prepareImage(command)).record.status).toBe('placeholder');
  });
  it('fetches CDN images in the worker only with the optional grant', async () => {
    const images = await import('../src/background/images');
    const prepared = await images.prepareImage({
      type: 'storeImage',
      notebookId: 'n',
      messageId: 'q1',
      image: { ...image, source: 'uploaded' },
      fetchUrl: 'https://files.oaiusercontent.com/file-1/a.jpg?sig=x',
    });
    expect(prepared.record).toMatchObject({ status: 'failed', error: /Allow image access/ });
    const elsewhere = await images.prepareImage({
      type: 'storeImage',
      notebookId: 'n',
      messageId: 'q1',
      image: { ...image, source: 'uploaded' },
      fetchUrl: 'https://evil.example/a.jpg',
    });
    expect(elsewhere.record).toMatchObject({ status: 'failed', error: /not supported/ });
  });
});

describe('reader', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
  afterEach(() => vi.unstubAllGlobals());
  it('shows images inline without changing the selectable text or highlight offsets', async () => {
    const { Message } = await import('../src/notebook/Message');
    const { NotebookImagesContext } = await import('../src/notebook/NotebookImages');
    const book = notebook();
    const records = [
      await saved(jpeg, { messageId: 'a1', index: 0 }),
      {
        ...(await saved(jpeg, { messageId: 'a1', index: 1 })),
        status: 'failed' as const,
        hash: undefined,
      },
    ];
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root')!);
    await act(async () =>
      root.render(
        createElement(
          NotebookImagesContext.Provider,
          { value: { records, retry: () => undefined, remove: () => undefined } },
          createElement(Message, {
            message: book.messages[1]!,
            highlights: book.highlights,
            disabled: false,
            onUpdate: () => undefined,
            onRemove: () => undefined,
          }),
        ),
      ),
    );
    const text = document.querySelector<HTMLElement>('[data-notebook-message-id="a1"]')!;
    expect(text.querySelectorAll('figure')).toHaveLength(2);
    expect(text.querySelector('img')!.getAttribute('loading')).toBe('lazy');
    expect(text.querySelector('.image-failed')!.getAttribute('data-label')).toBe(
      "Image couldn't be saved",
    );
    // Figures carry no DOM text, so offsets are those of message.text.
    expect(text.textContent).toBe(book.messages[1]!.text);
    expect(text.querySelector('mark')!.textContent).toBe('face south');
    const node = text.querySelector('mark')!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 10);
    const anchored = anchorSelection(text, range);
    expect(anchored.anchor.start).toBe(book.highlights[0]!.anchor.start);
    expect(resolveAnchor(book.messages[1]!.text, book.highlights[0]!)).toBe(49);
    act(() => root.unmount());
  });
});

/** Inflate the PDF's Flate content streams so drawn text can be searched. */
function pdfStreams(pdf: jsPDF): string {
  const raw = pdf.output();
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  const parts: string[] = [];
  const pattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    try {
      parts.push(strFromU8(unzlibSync(bytes.subarray(start, end).subarray(0, -1)), true));
    } catch {
      /* Image or uncompressed stream. */
    }
  }
  return parts.join('\n');
}
describe('PDF images', () => {
  const pdfImage = async (
    bytes: Uint8Array,
    fields: Partial<PdfImage> & Pick<PdfImage, 'messageId' | 'index'>,
  ): Promise<PdfImage> => ({
    offset: 38,
    alt: 'Garden layout sketch',
    status: 'saved',
    width: 320,
    height: 200,
    hash: await sha256Hex(bytes),
    data: bytes,
    format: 'JPEG',
    ...fields,
  });
  it('embeds images, keeps aspect ratio, and never splits one across pages', async () => {
    const book = notebook();
    book.messages[1]!.text = `${'A long paragraph about soil and water. '.repeat(120)}\n\nEnd.`;
    book.highlights = [];
    const api = jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown };
    const spy = vi.spyOn(api, 'addImage');
    const images = [
      await pdfImage(jpeg, { messageId: 'q1', index: 0, offset: 0 }),
      await pdfImage(tall, {
        messageId: 'a1',
        index: 0,
        offset: book.messages[1]!.text.length - 6,
        width: 200,
        height: 900,
      }),
      await pdfImage(png, {
        messageId: 'a1',
        index: 1,
        offset: book.messages[1]!.text.length,
        width: 120,
        height: 120,
        format: 'PNG',
        alt: '',
      }),
      {
        messageId: 'a1',
        index: 2,
        offset: 5,
        alt: 'Cherry',
        status: 'placeholder',
        pageUrl: 'https://garden.example/cherry',
      } satisfies PdfImage,
    ];
    const pdf = createNotebookPdf(book, undefined, undefined, images);
    const calls = spy.mock.calls.map(
      (call) => call.slice(1, 6) as unknown as [string, number, number, number, number],
    );
    spy.mockRestore();
    expect(calls).toHaveLength(3);
    for (const [, , y, w, h] of calls) {
      expect(y + h).toBeLessThanOrEqual(277);
      expect(w).toBeLessThanOrEqual(172);
    }
    // Aspect ratio of the tall image is preserved after scaling to fit a page.
    const [, , , w, h] = calls[1]!;
    expect(h / w).toBeCloseTo(900 / 200, 1);
    const written = pdfStreams(pdf);
    expect(written).toContain('(Garden layout sketch)');
    expect(written).toContain('Web image not saved: Cherry');
    const output = pdf.output();
    // Three images, plus the soft mask jsPDF adds for the transparent PNG.
    expect(output.match(/\/Subtype \/Image/g)?.length).toBe(4);
    expect(output.match(/\/SMask/g)?.length).toBe(1);
  });
  it('omits images when the export option is off', () => {
    const output = createNotebookPdf(notebook(), undefined, undefined, []).output();
    expect(output).not.toContain('/Subtype /Image');
  });
});

describe('backup and Markdown', () => {
  const db: Database = {
    version: 1,
    notebooks: [notebook()],
    activeByConversation: { 'ChatGPT:garden': 'n' },
    pausedConversations: [],
  };
  it('round-trips notebooks and images through a ZIP backup', async () => {
    const records = [
      await saved(jpeg, { messageId: 'a1', index: 0 }),
      await saved(png, { messageId: 'q1', index: 0, offset: 0, mime: 'image/png' }),
      {
        ...(await saved(jpeg, { messageId: 'a1', index: 1 })),
        status: 'placeholder' as const,
        hash: undefined,
        source: 'web' as const,
      },
    ];
    const blobs = [
      { hash: records[0]!.hash!, mime: 'image/jpeg' as const, bytes: jpeg },
      { hash: records[1]!.hash!, mime: 'image/png' as const, bytes: png },
    ];
    const zip = encodeNotebookArchive(
      db,
      records,
      blobs,
      '3.0.3',
      undefined,
      '2026-10-22T00:00:00.000Z',
    );
    const { archive, blobs: restored } = await decodeNotebookArchive(zip);
    expect(archive.database).toEqual(db);
    expect(archive.images).toEqual(records);
    expect(restored.map((b) => [b.hash, b.mime, b.bytes.length]).sort()).toEqual(
      blobs.map((b) => [b.hash, b.mime, b.bytes.length]).sort(),
    );
  });
  it('rejects damaged image files and still reads format-1 JSON backups', async () => {
    const record = await saved(jpeg, { messageId: 'a1', index: 0 });
    const zip = encodeNotebookArchive(
      db,
      [record],
      [{ hash: record.hash!, mime: 'image/jpeg', bytes: png }],
      '3.0.3',
    );
    await expect(decodeNotebookArchive(zip)).rejects.toThrow(/damaged/);
    const { serializeNotebookBackup } = await import('../src/storage/backup');
    const legacy = new TextEncoder().encode(serializeNotebookBackup(db, '3.0.3'));
    expect((await decodeNotebookArchive(legacy)).archive.images).toEqual([]);
  });
  it('imports only new notebooks, paused', () => {
    const existing: Database = { ...db, notebooks: [notebook('n')] };
    const incoming: Database = {
      version: 1,
      notebooks: [notebook('n'), notebook('m')],
      activeByConversation: {},
      pausedConversations: [],
    };
    const { next, imported, skipped } = mergeImport(existing, incoming);
    expect(imported).toEqual(['m']);
    expect(skipped).toBe(1);
    expect(next.notebooks.map((n) => n.id)).toEqual(['n', 'm']);
    expect(next.activeByConversation).toEqual(existing.activeByConversation);
  });
  it('writes Markdown with relative asset links at the image position', async () => {
    const record = await saved(jpeg, { messageId: 'a1', index: 0 });
    const markdown = notebookMarkdown(notebook(), [record]);
    expect(markdown).toContain(
      `Here is a sketch of the garden layout.\n\n![Garden layout sketch](assets/${record.hash}.jpg)\n\nThe beds face south`,
    );
    expect(markdown).toContain('> face south');
  });
});
