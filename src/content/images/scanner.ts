import { extension } from '../../browser/api';
import type { AIPlatformAdapter } from '../../types';
import { projectMessageText } from '../chatgpt/projection';
import { detectImages, type DetectedImage } from './detect';
import { fetchImage, processImage, toBase64 } from '../../images/process';
import { isImageHost, storedImageUrl, type ImageStatus } from '../../images/types';
import type { ImageSettings } from '../../images/settings';

interface ImageState {
  ok: boolean;
  settings?: ImageSettings;
  notebookId?: string;
  messageIds?: string[];
  records?: { messageId: string; index: number; status: ImageStatus; url: string }[];
}
export interface ScanOptions {
  notebookId?: string;
  /** Explicit capture: retry failed images and re-check placeholders. */
  force?: boolean;
  only?: { messageId: string; index: number };
}
export interface ScanSummary {
  saved: number;
  failed: number;
  placeholders: number;
}
type Send = (message: unknown) => Promise<unknown>;
const sameOrigin = (url: string) => {
  try {
    return new URL(url).origin === location.origin;
  } catch {
    return false;
  }
};
export function createImageScanner(
  adapter: AIPlatformAdapter,
  send: Send = (message) => extension.runtime.sendMessage(message),
  process = processImage,
) {
  // Failed fetches retry once per page load, or on an explicit request.
  const attempted = new Set<string>();
  let running: Promise<ScanSummary> | undefined;
  let again = false;
  async function captureOne(
    notebookId: string,
    messageId: string,
    image: DetectedImage,
    settings: ImageSettings,
  ) {
    const meta = {
      index: image.index,
      offset: image.offset,
      alt: image.alt,
      url: storedImageUrl(image.url),
      ...(image.pageUrl ? { pageUrl: image.pageUrl } : {}),
      source: image.source,
    };
    const store = (body: Record<string, unknown>) =>
      send({ type: 'storeImage', notebookId, messageId, image: meta, ...body }) as Promise<{
        ok: boolean;
        status?: ImageStatus;
      }>;
    if (image.source === 'web' && !settings.includeWebImages)
      return store({ status: 'placeholder' });
    try {
      // The page session is preferred: same-origin ChatGPT and Claude files
      // need its cookies. Cross-origin CDNs may block this with CORS.
      const blob = await fetchImage(image.url, sameOrigin(image.url) ? 'include' : 'omit');
      const processed = await process(blob);
      return store({
        data: {
          base64: toBase64(processed.bytes),
          mime: processed.mime,
          hash: processed.hash,
          width: processed.width,
          height: processed.height,
        },
      });
    } catch (error) {
      if (isImageHost(image.url)) return store({ fetchUrl: image.url });
      return store({
        status: image.source === 'web' ? 'placeholder' : 'failed',
        error: error instanceof Error ? error.message.slice(0, 300) : undefined,
      });
    }
  }
  async function run(options: ScanOptions): Promise<ScanSummary> {
    const summary: ScanSummary = { saved: 0, failed: 0, placeholders: 0 };
    const state = (await send({
      type: 'imageState',
      platform: adapter.platform,
      conversationId: adapter.getConversationId(),
      notebookId: options.notebookId,
    })) as ImageState;
    if (!state?.ok || !state.notebookId || !state.settings?.saveImages) return summary;
    const known = new Map(state.records?.map((r) => [`${r.messageId}:${r.index}`, r]));
    const inNotebook = new Set(state.messageIds);
    for (const message of adapter.sourceMessages()) {
      if (!inNotebook.has(message.id)) continue;
      if (options.only && options.only.messageId !== message.id) continue;
      const projection = projectMessageText(message.element, true);
      for (const image of detectImages(message.element, message.role, projection)) {
        if (options.only && options.only.index !== image.index) continue;
        // Lazy images without a URL, or still loading, are picked up on a later mutation.
        if (!image.url || (!image.element.complete && !image.url.startsWith('data:'))) continue;
        const key = `${message.id}:${image.index}`;
        const previous = known.get(key);
        const sameUrl = previous?.url === storedImageUrl(image.url);
        if (previous?.status === 'removed' && !options.only) continue;
        if (previous?.status === 'saved' && sameUrl) continue;
        if (previous?.status === 'placeholder' && sameUrl && !options.force) continue;
        if (!options.force && !options.only && attempted.has(`${key}:${image.url}`)) continue;
        attempted.add(`${key}:${image.url}`);
        const result = await captureOne(state.notebookId, message.id, image, state.settings);
        if (result?.status === 'saved') summary.saved++;
        else if (result?.status === 'placeholder') summary.placeholders++;
        else summary.failed++;
      }
    }
    return summary;
  }
  /** One scan at a time; a request during a scan queues one more pass. */
  function scan(options: ScanOptions = {}): Promise<ScanSummary> {
    if (running && !options.force && !options.only) {
      again = true;
      return running;
    }
    const previous = running ?? Promise.resolve(undefined);
    const task = previous
      .catch(() => undefined)
      .then(() => run(options))
      .finally(() => {
        if (running === task) running = undefined;
        if (again) {
          again = false;
          void scan().catch(() => undefined);
        }
      });
    running = task;
    return task;
  }
  return { scan };
}
