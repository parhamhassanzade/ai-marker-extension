import { strToU8, zipSync } from 'fflate';
import type { Notebook } from '../types';
import type { ImageRecord } from '../images/types';
import type { ArchiveBlob } from '../storage/archive';
import { chaptersOf, chapterTitle } from '../notebook/chapters';

const labels = { yellow: 'Highlight', green: 'Definition', red: 'Important' } as const;
const escapeAlt = (value: string) => value.replace(/[[\]\\]/g, '\\$&').replace(/\s+/g, ' ');
export const assetPath = (record: Pick<ImageRecord, 'hash' | 'mime'>) =>
  `assets/${record.hash}.${record.mime === 'image/png' ? 'png' : 'jpg'}`;
function imageMarkdown(record: ImageRecord): string {
  const alt = escapeAlt(record.alt);
  if (record.status === 'saved' && record.hash) return `![${alt}](${assetPath(record)})`;
  if (record.status === 'placeholder')
    return record.pageUrl
      ? `_[Web image not saved${alt ? `: ${alt}` : ''}](<${record.pageUrl}>)_`
      : `_Web image not saved${alt ? `: ${alt}` : ''}_`;
  return `_Image couldn’t be saved${alt ? `: ${alt}` : ''}_`;
}
/** Markdown with images at their captured offsets; message.text is unchanged. */
export function notebookMarkdown(notebook: Notebook, images: ImageRecord[]): string {
  const out: string[] = [`# ${notebook.title}`, ''];
  out.push(
    `${notebook.platform} conversation: <${notebook.website}>  `,
    `Created ${new Date(notebook.createdAt).toISOString().slice(0, 10)}`,
    '',
  );
  if (notebook.overview?.summary) out.push('## Overview', '', notebook.overview.summary, '');
  for (const chapter of chaptersOf(notebook.messages)) {
    out.push(`## Chapter ${String(chapter.number).padStart(2, '0')}: ${chapterTitle(chapter)}`, '');
    for (const message of chapter.messages) {
      out.push(message.role === 'user' ? '**Your question**' : '**AI response**', '');
      const media = images
        .filter((r) => r.messageId === message.id && r.status !== 'removed')
        .sort((a, b) => a.offset - b.offset || a.index - b.index);
      let cursor = 0;
      const parts: string[] = [];
      for (const record of media) {
        const offset = Math.min(Math.max(record.offset, cursor), message.text.length);
        parts.push(message.text.slice(cursor, offset).trim(), imageMarkdown(record));
        cursor = offset;
      }
      parts.push(message.text.slice(cursor).trim());
      out.push(parts.filter(Boolean).join('\n\n'), '');
    }
  }
  if (notebook.highlights.length) {
    out.push('## Your saved highlights', '');
    for (const highlight of notebook.highlights) {
      out.push(
        `### ${labels[highlight.color]}${highlight.bookmarked ? ' · Bookmarked' : ''}`,
        '',
        ...highlight.text.split('\n').map((line) => `> ${line}`),
        '',
      );
      if (highlight.note) out.push(`Note: ${highlight.note}`, '');
      if (highlight.tags?.length) out.push(highlight.tags.map((tag) => `#${tag}`).join(' '), '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
export function markdownArchive(
  notebook: Notebook,
  images: ImageRecord[],
  blobs: ArchiveBlob[],
  fileName: string,
): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [`${fileName}.md`]: [strToU8(notebookMarkdown(notebook, images)), { level: 6 }],
  };
  const byHash = new Map(blobs.map((blob) => [blob.hash, blob]));
  for (const record of images) {
    const blob = record.status === 'saved' && record.hash ? byHash.get(record.hash) : undefined;
    if (blob) files[assetPath(record)] = [blob.bytes, { level: 0 }];
  }
  return zipSync(files);
}
