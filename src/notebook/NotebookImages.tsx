import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, RefreshCw, X } from 'lucide-react';
import { extension, isExtensionContext } from '../browser/api';
import { getImageBlob, listImages } from '../storage/indexedDB';
import type { ImageRecord } from '../images/types';

export interface NotebookImages {
  records: ImageRecord[];
  retry(messageId: string, index: number): void;
  remove(messageId: string, index: number): void;
}
const empty: NotebookImages = { records: [], retry: () => undefined, remove: () => undefined };
export const NotebookImagesContext = createContext<NotebookImages>(empty);
export const useImages = () => useContext(NotebookImagesContext);

/** Image records come straight from IndexedDB; the worker remains the only writer. */
export function useNotebookImageRecords(notebookId: string | undefined) {
  const [records, setRecords] = useState<ImageRecord[]>([]);
  const reload = useCallback(async () => {
    if (!notebookId || !isExtensionContext()) return setRecords([]);
    try {
      setRecords(await listImages(notebookId));
    } catch {
      setRecords([]);
    }
  }, [notebookId]);
  useEffect(() => {
    void reload();
    if (!isExtensionContext()) return;
    const changed = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (
        sender.id === extension.runtime.id &&
        typeof message === 'object' &&
        message &&
        'type' in message &&
        'notebookId' in message &&
        message.type === 'imagesChanged' &&
        message.notebookId === notebookId
      )
        void reload();
      return false;
    };
    extension.runtime.onMessage.addListener(changed);
    return () => extension.runtime.onMessage.removeListener(changed);
  }, [notebookId, reload]);
  return { records, reload };
}
export function imageStorageBytes(records: ImageRecord[]): number {
  const unique = new Map<string, number>();
  for (const record of records)
    if (record.status === 'saved' && record.hash) unique.set(record.hash, record.bytes ?? 0);
  return [...unique.values()].reduce((sum, bytes) => sum + bytes, 0);
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function useBlobUrl(hash: string | undefined, element: React.RefObject<HTMLElement | null>) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!hash) return;
    let created: string | undefined;
    let cancelled = false;
    const load = () => {
      void getImageBlob(hash).then((record) => {
        if (cancelled || !record) return;
        created = URL.createObjectURL(record.blob);
        setUrl(created);
      });
    };
    // Read image bytes only when the figure approaches the viewport.
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'function' && element.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            load();
          }
        },
        { rootMargin: '600px' },
      );
      observer.observe(element.current);
    } else load();
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (created) URL.revokeObjectURL(created);
    };
  }, [hash, element]);
  return url;
}
// Figures sit inside the selectable message text. They contain no DOM text, so
// selection offsets (range.toString / textContent) are unchanged; visible labels
// and captions come from CSS attr() content.
export function ImageFigure({ record }: { record: ImageRecord }) {
  const { retry, remove } = useImages();
  const ref = useRef<HTMLElement>(null);
  const url = useBlobUrl(record.status === 'saved' ? record.hash : undefined, ref);
  const [full, setFull] = useState(false);
  if (record.status === 'removed') return null;
  if (record.status === 'placeholder')
    return (
      <figure
        ref={ref}
        className="message-image image-placeholder"
        contentEditable={false}
        data-notebook-media=""
        data-label={record.alt ? `Web image: ${record.alt}` : 'Web image not saved'}
        aria-label={record.alt ? `Web image not saved: ${record.alt}` : 'Web image not saved'}
      >
        <ImageOff size={16} aria-hidden />
        {record.pageUrl && (
          <a
            href={record.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-label="Open source page"
            aria-label="Open the image's source page"
          />
        )}
      </figure>
    );
  if (record.status === 'failed')
    return (
      <figure
        ref={ref}
        className="message-image image-failed"
        contentEditable={false}
        data-notebook-media=""
        data-label="Image couldn't be saved"
        aria-label={`Image couldn't be saved${record.error ? `: ${record.error}` : ''}`}
        title={record.error}
      >
        <ImageOff size={16} aria-hidden />
        <button
          className="text-button"
          data-label="Retry"
          aria-label="Retry saving this image"
          onClick={() => retry(record.messageId, record.index)}
        >
          <RefreshCw size={13} aria-hidden />
        </button>
      </figure>
    );
  return (
    <figure
      ref={ref}
      className="message-image"
      contentEditable={false}
      data-notebook-media=""
      data-caption={record.alt || undefined}
    >
      <button
        className="image-open"
        aria-label={record.alt ? `View full size: ${record.alt}` : 'View image full size'}
        onClick={() => setFull(true)}
      >
        <img
          src={url}
          alt={record.alt}
          loading="lazy"
          width={record.width}
          height={record.height}
        />
      </button>
      <button
        className="icon-button image-remove"
        aria-label="Remove image from notebook"
        onClick={() => remove(record.messageId, record.index)}
      >
        <X size={13} aria-hidden />
      </button>
      {full &&
        url &&
        createPortal(
          <div
            className="image-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={record.alt || 'Image'}
            onClick={() => setFull(false)}
            onKeyDown={(event) => event.key === 'Escape' && setFull(false)}
          >
            <img src={url} alt={record.alt} />
            <button className="icon-button" aria-label="Close image" autoFocus>
              <X size={18} />
            </button>
          </div>,
          document.body,
        )}
    </figure>
  );
}
