/**
 * Link previews (WhatsApp, Facebook, iMessage…): the page's photo as a small 1200×630 JPEG made by /api/og, because
 * WhatsApp shows no picture for big files (a 3 MB PNG cover) or WebP. Use in generateMetadata: openGraph.images.
 */
export function ogImages(src: string | null | undefined, alt = '') {
  if (!src) return [];
  // Photos on another site: give them as they are.
  if (/^https?:\/\//i.test(src)) return [{ url: src, alt }];
  return [{ url: `/api/og?src=${encodeURIComponent(src)}`, width: 1200, height: 630, type: 'image/jpeg', alt }];
}
