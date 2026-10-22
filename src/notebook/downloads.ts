import { encodeNotebookArchive, type ArchiveBlob } from '../storage/archive';
import { getImageBlob, listImages } from '../storage/indexedDB';
import { extension } from '../browser/api';
import type { Database, Notebook } from '../types';
import type { ImageRecord } from '../images/types';
import { markdownArchive } from '../export/markdown';

export function safeFileName(title: string) {
  return (
    title
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .slice(0, 80) || 'AI Notebook'
  );
}
export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
async function imagesFor(notebookIds: string[]) {
  const records: ImageRecord[] = (await Promise.all(notebookIds.map(listImages))).flat();
  const blobs: ArchiveBlob[] = [];
  for (const hash of new Set(records.map((r) => (r.status === 'saved' ? r.hash : undefined))))
    if (hash) {
      const blob = await getImageBlob(hash);
      if (blob)
        blobs.push({ hash, mime: blob.mime, bytes: new Uint8Array(await blob.blob.arrayBuffer()) });
    }
  return { records, blobs };
}
export async function exportBackup(db: Database, notebookId?: string) {
  const ids = notebookId ? [notebookId] : db.notebooks.map((n) => n.id);
  const { records, blobs } = await imagesFor(ids);
  const bytes = encodeNotebookArchive(
    db,
    records,
    blobs,
    extension.runtime.getManifest().version,
    notebookId,
  );
  const date = new Date().toISOString().slice(0, 10);
  downloadBytes(bytes, `AI Notebook backup ${date}.zip`, 'application/zip');
}
export async function exportMarkdown(notebook: Notebook) {
  const { records, blobs } = await imagesFor([notebook.id]);
  const name = safeFileName(notebook.title);
  downloadBytes(markdownArchive(notebook, records, blobs, name), `${name}.zip`, 'application/zip');
}
