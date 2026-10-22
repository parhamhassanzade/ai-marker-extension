import type { Message } from '../../types';
import { isHidden } from '../chatgpt/detector';
import { isImageHost, MAX_IMAGES_PER_MESSAGE, type ImageSource } from '../../images/types';
import type { MessageProjection } from '../chatgpt/projection';
import { platformOf } from '../../platforms';

// Web-search results and carousels show third-party thumbnails. They are kept
// as placeholders unless the user opts in. Selectors are synthetic patterns.
const WEB_CONTAINER =
  '[data-testid*="carousel"], [class*="carousel"], [data-testid*="image-gallery"], [data-testid*="search-result"], [data-testid*="web-image"]';
const ICON_CONTAINER = '[class*="avatar"], [data-testid*="avatar"], [class*="favicon"]';

function size(image: HTMLImageElement, axis: 'width' | 'height') {
  const natural = axis === 'width' ? image.naturalWidth : image.naturalHeight;
  return natural || Number(image.getAttribute(axis)) || 0;
}
export function imageUrl(image: HTMLImageElement): string {
  const fromSet = (value: string | null) =>
    value
      ?.split(',')
      .map((entry) => entry.trim().split(/\s+/))
      .filter(([url]) => url)
      .sort((a, b) => parseFloat(b[1] ?? '0') - parseFloat(a[1] ?? '0'))[0]?.[0];
  const raw =
    image.currentSrc ||
    image.getAttribute('src') ||
    fromSet(image.getAttribute('srcset')) ||
    image.getAttribute('data-src') ||
    '';
  try {
    return raw ? new URL(raw, location.href).href : '';
  } catch {
    return '';
  }
}
/** Content images of a message, in document order. Icons and avatars are skipped. */
export function messageImages(root: Element): HTMLImageElement[] {
  return Array.from(root.querySelectorAll('img'))
    .filter((image) => {
      if (isHidden(image) || image.closest(ICON_CONTAINER)) return false;
      const width = size(image, 'width');
      const height = size(image, 'height');
      // Unknown sizes are lazy images that have not loaded yet; keep them.
      return !((width && width < 40) || (height && height < 40));
    })
    .slice(0, MAX_IMAGES_PER_MESSAGE);
}
export function imageSource(image: HTMLImageElement, role: Message['role']): ImageSource {
  const url = imageUrl(image);
  // ChatGPT/Claude hosts and OpenAI's file CDN serve the conversation's own images.
  const firstParty =
    url.startsWith('blob:') || url.startsWith('data:') || !!platformOf(url) || isImageHost(url);
  if (image.closest(WEB_CONTAINER) || (url && !firstParty)) return 'web';
  return role === 'user' ? 'uploaded' : 'generated';
}
/** Canonical text offset immediately before the image, from projection spans. */
export function imageOffset(image: Element, projection: MessageProjection): number {
  let offset = 0;
  for (const span of projection.spans)
    if (span.node.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING)
      offset = Math.max(offset, span.end);
  return Math.min(offset, projection.text.length);
}
export interface DetectedImage {
  element: HTMLImageElement;
  index: number;
  offset: number;
  url: string;
  alt: string;
  pageUrl?: string;
  source: ImageSource;
  width: number;
  height: number;
}
export function detectImages(
  root: HTMLElement,
  role: Message['role'],
  projection: MessageProjection,
): DetectedImage[] {
  return messageImages(root).map((element, index) => {
    const link = element.closest('a[href]')?.getAttribute('href');
    let pageUrl: string | undefined;
    try {
      pageUrl = link ? new URL(link, location.href).href : undefined;
      if (pageUrl && !/^https?:$/.test(new URL(pageUrl).protocol)) pageUrl = undefined;
    } catch {
      pageUrl = undefined;
    }
    return {
      element,
      index,
      offset: imageOffset(element, projection),
      url: imageUrl(element),
      alt: (element.getAttribute('alt') ?? '').trim().slice(0, 1000),
      ...(pageUrl ? { pageUrl: pageUrl.slice(0, 3000) } : {}),
      source: imageSource(element, role),
      width: size(element, 'width'),
      height: size(element, 'height'),
    };
  });
}
