export type ImageSource = 'generated' | 'uploaded' | 'web';
export type ImageStatus = 'saved' | 'failed' | 'placeholder' | 'removed';
export const MAX_IMAGES_PER_MESSAGE = 50;
export const MAX_IMAGE_SIDE = 1600;
export const MAX_FETCH_BYTES = 25 * 1024 * 1024;
/** Hosts fetched by the worker when a content-script fetch is blocked by CORS. */
export const IMAGE_HOST_ORIGINS = ['https://*.oaiusercontent.com/*'];
export function isImageHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.oaiusercontent.com');
  } catch {
    return false;
  }
}
/** One image position in a captured message, kept outside the notebook record. */
export interface ImageRecord {
  notebookId: string;
  messageId: string;
  /** Order among the message's images; equals the content model's image index. */
  index: number;
  /** Canonical offset in message.text immediately before the image. */
  offset: number;
  alt: string;
  /** Original URL with signing parameters removed. */
  url: string;
  /** For web images: the page the image links to. */
  pageUrl?: string;
  source: ImageSource;
  status: ImageStatus;
  /** SHA-256 of the stored bytes; present when status is 'saved'. */
  hash?: string;
  mime?: 'image/jpeg' | 'image/png';
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
  capturedAt: string;
}
export interface ImageBlobRecord {
  hash: string;
  blob: Blob;
  mime: 'image/jpeg' | 'image/png';
  bytes: number;
}
/** Remove expiring signatures; the URL is kept for reference only. */
export function storedImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return `${parsed.protocol}…`;
    if (isImageHost(url)) parsed.search = '';
    else if (parsed.pathname.includes('/backend-api/')) {
      const id = parsed.searchParams.get('id');
      parsed.search = id ? `?id=${encodeURIComponent(id)}` : '';
    }
    return parsed.href.slice(0, 3000);
  } catch {
    return '';
  }
}
