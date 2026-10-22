import { extension } from '../browser/api';
import { conversationIdOf, platformOf } from '../platforms';
import { conversationKey } from '../storage/repository';
import { putImage, removeImage } from '../storage/indexedDB';
import { getImageSettings } from '../images/settings';
import { fetchImage, fromBase64, processImage, sha256Hex } from '../images/process';
import {
  IMAGE_HOST_ORIGINS,
  isImageHost,
  MAX_IMAGES_PER_MESSAGE,
  storedImageUrl,
  type ImageRecord,
  type ImageSource,
} from '../images/types';
import type { Database, Platform } from '../types';
import { listImages } from '../storage/indexedDB';

export interface ImageInput {
  index: number;
  offset: number;
  alt: string;
  url: string;
  pageUrl?: string;
  source: ImageSource;
}
export type StoreImageCommand = {
  type: 'storeImage';
  notebookId: string;
  messageId: string;
  image: ImageInput;
} & (
  | {
      data: {
        base64: string;
        mime: 'image/jpeg' | 'image/png';
        hash: string;
        width: number;
        height: number;
      };
    }
  | { fetchUrl: string }
  | { status: 'failed' | 'placeholder'; error?: string }
);
export type ImageCommand =
  | { type: 'imageState'; platform: Platform; conversationId: string; notebookId?: string }
  | StoreImageCommand
  | { type: 'removeImage'; notebookId: string; messageId: string; index: number };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit;
const count = (value: unknown, max: number) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
function isInput(value: unknown): value is ImageInput {
  return (
    record(value) &&
    count(value.index, MAX_IMAGES_PER_MESSAGE - 1) &&
    count(value.offset, 2_000_000) &&
    text(value.alt, 1000) &&
    text(value.url, 3000) &&
    (value.pageUrl === undefined || text(value.pageUrl, 3000)) &&
    ['generated', 'uploaded', 'web'].includes(String(value.source))
  );
}
export function isImageCommand(value: unknown): value is ImageCommand {
  if (!record(value)) return false;
  if (value.type === 'imageState')
    return (
      ['ChatGPT', 'Claude'].includes(String(value.platform)) &&
      text(value.conversationId, 300) &&
      (value.notebookId === undefined || text(value.notebookId, 100))
    );
  if (value.type === 'removeImage')
    return (
      text(value.notebookId, 100) &&
      text(value.messageId, 300) &&
      count(value.index, MAX_IMAGES_PER_MESSAGE - 1)
    );
  if (value.type !== 'storeImage') return false;
  if (!text(value.notebookId, 100) || !text(value.messageId, 300) || !isInput(value.image))
    return false;
  if ('data' in value)
    return (
      record(value.data) &&
      text(value.data.base64, 28_000_000) &&
      ['image/jpeg', 'image/png'].includes(String(value.data.mime)) &&
      /^[0-9a-f]{64}$/.test(String(value.data.hash)) &&
      count(value.data.width, 1600) &&
      count(value.data.height, 1600)
    );
  if ('fetchUrl' in value) return text(value.fetchUrl, 8000);
  return (
    (value.status === 'failed' || value.status === 'placeholder') &&
    (value.error === undefined || text(value.error, 300))
  );
}
/** The notebook a content script may write to: same platform and conversation. */
function senderMayWrite(db: Database, notebookId: string, sender: chrome.runtime.MessageSender) {
  const notebook = db.notebooks.find((n) => n.id === notebookId);
  if (!notebook) return undefined;
  if (sender.url?.startsWith(extension.runtime.getURL('/'))) return notebook;
  const url = sender.tab?.url ?? sender.url;
  if ((sender.frameId ?? 0) !== 0 || platformOf(url) !== notebook.platform) return undefined;
  const id = conversationIdOf(notebook.platform, new URL(url!).pathname);
  return id === notebook.conversationId || (!id && notebook.conversationId.startsWith('temporary:'))
    ? notebook
    : undefined;
}
export async function imageState(
  db: Database,
  command: Extract<ImageCommand, { type: 'imageState' }>,
) {
  const key = conversationKey(command);
  const notebook = command.notebookId
    ? db.notebooks.find((n) => n.id === command.notebookId && conversationKey(n) === key)
    : db.notebooks.find((n) => n.id === db.activeByConversation[key]);
  const settings = await getImageSettings();
  if (!notebook) return { ok: true as const, settings };
  return {
    ok: true as const,
    settings,
    notebookId: notebook.id,
    messageIds: notebook.messages.map((m) => m.id),
    records: (await listImages(notebook.id)).map(({ messageId, index, status, url }) => ({
      messageId,
      index,
      status,
      url,
    })),
  };
}
/** Bytes are fetched and processed outside the write queue; the write is queued. */
export async function prepareImage(
  command: StoreImageCommand,
): Promise<{ record: Omit<ImageRecord, 'notebookId'>; blob?: Blob }> {
  const { image } = command;
  const base = {
    messageId: command.messageId,
    index: image.index,
    offset: image.offset,
    alt: image.alt,
    url: storedImageUrl(image.url),
    ...(image.pageUrl ? { pageUrl: image.pageUrl } : {}),
    source: image.source,
    capturedAt: new Date().toISOString(),
  };
  const settings = await getImageSettings();
  if (!settings.saveImages) throw new Error('Saving images is turned off.');
  const placeholder = image.source === 'web' && !settings.includeWebImages;
  if (placeholder || ('status' in command && command.status === 'placeholder'))
    return { record: { ...base, status: 'placeholder' } };
  if ('status' in command)
    return {
      record: { ...base, status: 'failed', error: command.error ?? 'Image couldn’t be saved.' },
    };
  try {
    let bytes: Uint8Array;
    let meta: { hash: string; mime: 'image/jpeg' | 'image/png'; width: number; height: number };
    if ('data' in command) {
      bytes = fromBase64(command.data.base64);
      if ((await sha256Hex(bytes)) !== command.data.hash)
        throw new Error('Image data was corrupted.');
      meta = command.data;
    } else {
      // Only known ChatGPT image hosts, and only with the optional grant.
      if (!isImageHost(command.fetchUrl)) throw new Error('This image host is not supported.');
      const granted = await Promise.resolve()
        .then(() => extension.permissions.contains({ origins: IMAGE_HOST_ORIGINS }))
        .catch(() => false);
      if (!granted) throw new Error('Allow image access in AI Notebook to save this image.');
      const processed = await processImage(await fetchImage(command.fetchUrl, 'omit'));
      bytes = processed.bytes;
      meta = processed;
    }
    return {
      record: { ...base, status: 'saved', ...meta, bytes: bytes.length },
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: meta.mime }),
    };
  } catch (error) {
    return {
      record: {
        ...base,
        status: image.source === 'web' ? 'placeholder' : 'failed',
        error: error instanceof Error ? error.message.slice(0, 300) : 'Image couldn’t be saved.',
      },
    };
  }
}
export async function commitImage(
  db: Database,
  command: StoreImageCommand,
  sender: chrome.runtime.MessageSender,
  prepared: Awaited<ReturnType<typeof prepareImage>>,
) {
  const notebook = senderMayWrite(db, command.notebookId, sender);
  const message = notebook?.messages.find((m) => m.id === command.messageId);
  if (!notebook || !message) throw new Error('This image no longer belongs to a notebook message.');
  const record: ImageRecord = {
    ...prepared.record,
    notebookId: notebook.id,
    offset: Math.min(prepared.record.offset, message.text.length),
  };
  await putImage(
    record,
    prepared.blob && record.hash
      ? { hash: record.hash, blob: prepared.blob, mime: record.mime!, bytes: record.bytes! }
      : undefined,
  );
  return record;
}
export async function removeStoredImage(command: Extract<ImageCommand, { type: 'removeImage' }>) {
  await removeImage(command);
}
export { senderMayWrite };
