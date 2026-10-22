import { MAX_FETCH_BYTES, MAX_IMAGE_SIDE } from './types';

export interface ProcessedImage {
  hash: string;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: Uint8Array;
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
/** Fetch image bytes immediately: ChatGPT image links are signed and expire. */
export async function fetchImage(url: string, credentials: RequestCredentials): Promise<Blob> {
  const response = await fetch(url, {
    credentials,
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 404 || response.status === 410
        ? `The image link has expired (HTTP ${response.status}).`
        : `The image could not be downloaded (HTTP ${response.status}).`,
    );
  if (Number(response.headers.get('content-length') ?? 0) > MAX_FETCH_BYTES)
    throw new Error('The image is larger than 25 MB.');
  const blob = await response.blob();
  if (blob.size > MAX_FETCH_BYTES) throw new Error('The image is larger than 25 MB.');
  // CDNs may label images application/octet-stream; decoding is the real check.
  // Text and JSON are error or login pages.
  if (/^text\/|json/.test(blob.type)) throw new Error('The link did not return an image.');
  return blob;
}
function hasTransparency(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! < 255) return true;
  return false;
}
/**
 * Downscale to at most 1600 px on the long side and re-encode. WebP, AVIF, and
 * GIF become JPEG (or PNG with transparency), which jsPDF can embed directly.
 */
export async function processImage(blob: Blob): Promise<ProcessedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('This image format could not be read.');
  }
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Images cannot be processed in this browser.');
    context.drawImage(bitmap, 0, 0, width, height);
    const transparent = blob.type !== 'image/jpeg' && hasTransparency(context, width, height);
    const mime = transparent ? 'image/png' : 'image/jpeg';
    const encoded = await canvas.convertToBlob(
      transparent ? { type: mime } : { type: mime, quality: 0.85 },
    );
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    return { hash: await sha256Hex(bytes), mime, width, height, bytes };
  } finally {
    bitmap.close();
  }
}
