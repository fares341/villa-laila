/**
 * Google Maps links: short share links (maps.app.goo.gl/…) carry no coordinates, so they are followed here (server
 * side) to the full link, which has the place's name and its pin. Only Google Maps addresses are followed.
 */
export type MapPlace = { url: string; lat: number | null; lng: number | null; name: string | null };

const GOOGLE = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)\//i;

/** Pin and place name written in a full Google Maps link, if it has them. */
export function readMapUrl(url: string): MapPlace {
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* keep as is */ }
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? u.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const nm = u.match(/\/place\/([^/@?]+)/)?.[1] ?? (!pin ? u.match(/[?&](?:q|query)=([^&]+)/)?.[1] : undefined);
  const name = nm ? nm.replace(/\+/g, ' ').trim().slice(0, 200) || null : null;
  return { url, lat: pin ? Number(pin[1]) : null, lng: pin ? Number(pin[2]) : null, name };
}

/** Follows a Google Maps link (up to 6 hops) to the full link and reads its pin and name. Never throws. */
export async function resolveMapUrl(raw: string): Promise<MapPlace | null> {
  let url = String(raw ?? '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/^http:/i, 'https:');
  if (!GOOGLE.test(url)) return null;
  let here = readMapUrl(url);
  if (here.lat != null) return here;
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; VillaLayla/1.0)' } }); }
    catch { break; }
    const next = res.headers.get('location');
    if (!next || res.status < 300 || res.status >= 400) break;
    url = new URL(next, url).toString();
    // Google's cookie page carries the real link in ?continue=
    const cont = /consent\.google\./.test(url) ? new URL(url).searchParams.get('continue') : null;
    if (cont) url = cont;
    if (!GOOGLE.test(url)) break;
    here = readMapUrl(url);
    if (here.lat != null) return here;
  }
  return here.name || here.lat != null ? { ...here, url: here.url } : null;
}
