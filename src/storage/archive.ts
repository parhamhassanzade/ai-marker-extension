import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Database } from '../types';
import { sha256Hex } from '../images/process';
import { MAX_IMAGES_PER_MESSAGE, type ImageRecord } from '../images/types';
import { isDatabase, parseNotebookBackup, serializeNotebookBackup } from './backup';

/** Backup format 2: a ZIP with backup.json and images/<sha256>.<jpg|png>. */
export interface NotebookArchive {
  formatVersion: 2;
  appVersion: string;
  exportedAt: string;
  database: Database;
  images: ImageRecord[];
}
export interface ArchiveBlob {
  hash: string;
  mime: 'image/jpeg' | 'image/png';
  bytes: Uint8Array;
}
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const extension = (mime: string) => (mime === 'image/png' ? 'png' : 'jpg');
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit;
const count = (value: unknown, max: number) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
export function isImageRecord(value: unknown): value is ImageRecord {
  return (
    record(value) &&
    text(value.notebookId, 100) &&
    text(value.messageId, 300) &&
    count(value.index, MAX_IMAGES_PER_MESSAGE - 1) &&
    count(value.offset, 2_000_000) &&
    text(value.alt, 1000) &&
    text(value.url, 3000) &&
    (value.pageUrl === undefined || text(value.pageUrl, 3000)) &&
    ['generated', 'uploaded', 'web'].includes(String(value.source)) &&
    ['saved', 'failed', 'placeholder', 'removed'].includes(String(value.status)) &&
    (value.status !== 'saved' ||
      (/^[0-9a-f]{64}$/.test(String(value.hash)) &&
        ['image/jpeg', 'image/png'].includes(String(value.mime)) &&
        count(value.width, 1600) &&
        count(value.height, 1600) &&
        count(value.bytes, 50_000_000))) &&
    (value.error === undefined || text(value.error, 300)) &&
    text(value.capturedAt, 40) &&
    Number.isFinite(Date.parse(String(value.capturedAt)))
  );
}
export function encodeNotebookArchive(
  database: Database,
  images: ImageRecord[],
  blobs: ArchiveBlob[],
  appVersion: string,
  notebookId?: string,
  exportedAt = new Date().toISOString(),
): Uint8Array {
  // Reuse the format-1 codec for selection and validation of the notebooks.
  const selected = parseNotebookBackup(
    serializeNotebookBackup(database, appVersion, notebookId, exportedAt),
  ).database;
  const ids = new Set(selected.notebooks.map((n) => n.id));
  const kept = images.filter((image) => ids.has(image.notebookId) && image.status !== 'removed');
  const needed = new Set(kept.map((image) => image.hash).filter(Boolean));
  const files: Record<string, Uint8Array> = {
    'backup.json': strToU8(
      JSON.stringify({
        formatVersion: 2,
        appVersion,
        exportedAt,
        database: selected,
        images: kept,
      } satisfies NotebookArchive),
    ),
  };
  for (const blob of blobs)
    if (needed.has(blob.hash)) files[`images/${blob.hash}.${extension(blob.mime)}`] = blob.bytes;
  // Images are already compressed; store them without a second deflate pass.
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [
        name,
        [data, { level: name.endsWith('.json') ? 6 : 0 }] as const,
      ]),
    ),
  );
}
/** Validates everything; never writes. Format-1 JSON backups are still accepted. */
export async function decodeNotebookArchive(
  bytes: Uint8Array,
): Promise<{ archive: NotebookArchive; blobs: ArchiveBlob[] }> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Notebook backup exceeds 512 MB.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    const legacy = parseNotebookBackup(strFromU8(bytes));
    return { archive: { ...legacy, formatVersion: 2, images: [] }, blobs: [] };
  }
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_ARCHIVE_BYTES) throw new Error('Notebook backup expands beyond 512 MB.');
        return file.name === 'backup.json' || /^images\/[0-9a-f]{64}\.(jpg|png)$/.test(file.name);
      },
    });
  } catch (error) {
    throw error instanceof Error && error.message.includes('512 MB')
      ? error
      : new Error('Notebook backup is not a valid ZIP file.');
  }
  const manifest = files['backup.json'];
  if (!manifest) throw new Error('Notebook backup is missing backup.json.');
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(manifest));
  } catch {
    throw new Error('Notebook backup is not valid JSON.');
  }
  if (
    !record(value) ||
    value.formatVersion !== 2 ||
    !text(value.appVersion, 100) ||
    !text(value.exportedAt, 40) ||
    !isDatabase(value.database) ||
    !Array.isArray(value.images) ||
    !value.images.every(isImageRecord)
  )
    throw new Error('Notebook backup has an unsupported format or invalid content.');
  const archive = value as unknown as NotebookArchive;
  const keys = new Set<string>();
  for (const image of archive.images) {
    const notebook = archive.database.notebooks.find((n) => n.id === image.notebookId);
    const key = `${image.notebookId}:${image.messageId}:${image.index}`;
    if (!notebook?.messages.some((m) => m.id === image.messageId) || keys.has(key))
      throw new Error('Notebook backup has an image for a missing message.');
    keys.add(key);
  }
  const blobs: ArchiveBlob[] = [];
  for (const [name, data] of Object.entries(files)) {
    if (name === 'backup.json') continue;
    const [, hash, ext] = name.match(/^images\/([0-9a-f]{64})\.(jpg|png)$/)!;
    if ((await sha256Hex(data)) !== hash) throw new Error('A backup image is damaged.');
    blobs.push({ hash: hash!, mime: ext === 'png' ? 'image/png' : 'image/jpeg', bytes: data });
  }
  const present = new Set(blobs.map((blob) => blob.hash));
  for (const image of archive.images)
    if (image.status === 'saved' && !present.has(image.hash!))
      throw new Error('Notebook backup is missing an image file.');
  return { archive, blobs };
}
