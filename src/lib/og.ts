/**
 * Link previews (WhatsApp, Facebook, iMessage…): the page's photo as a small 1200×630 JPEG made by /og/<id>.jpg (not under /api, which robots.txt closes to crawlers), because
 * WhatsApp shows no picture for big files (a 3 MB PNG cover) or WebP. Use in generateMetadata: openGraph.images.
 */
export function ogImages(src: string | null | undefined, alt = '') {
  if (!src) return [];
  // Photos on another site: give them as they are.
  if (/^https?:\/\//i.test(src)) return [{ url: src, alt }];
  const url = `/og/${Buffer.from(src, 'utf8').toString('base64url')}.jpg`;
  return [{ url, secureUrl: url, width: 1200, height: 630, type: 'image/jpeg', alt }];
}

/**
 * The picture for an event's link previews: its cover; else the first photo of its page; else the villa photo.
 * So every event (and every ticket of it) shows its own picture on WhatsApp, never an empty card.
 */
export async function eventShareImage(ev: { id: string; image?: string | null }): Promise<string> {
  if (ev.image) return ev.image;
  try {
    const { q } = await import('@/lib/db');
    const m = (await q<any>(`SELECT id, url FROM event_media WHERE event_id=$1 AND kind IN ('hero','meal') AND coalesce(mime,'') LIKE 'image/%' ORDER BY (kind='hero') DESC, sort_order, created_at LIMIT 1`, [ev.id]))[0];
    if (m) return m.url || `/api/media/event-media/${m.id}`;
  } catch { /* no photos */ }
  return '/photos/hero-02-poster.jpg';
}
