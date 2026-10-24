import { q } from '@/lib/db';
import { getSetting, setSetting } from './settings';
import { addDays, todayLocal } from '@/lib/dates';
import { SITE_KEYS, type ChannelKey } from './ota-bookings';

/**
 * Links to the hostel's own listing on each booking site, and the prices read from those public pages.
 * Reading is done by the lh-reader service (headless browser), once an hour; it only opens the public page.
 */
export type SiteKey = (typeof SITE_KEYS)[number];
export type Links = Partial<Record<SiteKey, string>>;
const LINK_SITE: Record<SiteKey, RegExp> = {
  booking_com: /(^|\.)booking\.com$/i, airbnb: /(^|\.)airbnb\.[a-z.]+$/i, hostelworld: /(^|\.)hostelworld\.com$/i,
  expedia_collect: /(^|\.)(expedia\.[a-z.]+|hotels\.com)$/i, expedia_hotel: /(^|\.)(expedia\.[a-z.]+|hotels\.com)$/i,
  agoda: /(^|\.)agoda\.com$/i,
};

export async function getLinks(): Promise<Links> { return ((await getSetting<Links>('channel_links').catch(() => null)) ?? {}) as Links; }

export async function saveLink(channel: SiteKey, url: string) {
  const links = await getLinks();
  const u = url.trim();
  if (!u) { delete links[channel]; }
  else {
    let parsed: URL;
    try { parsed = new URL(u); } catch { throw new Error('That is not a link. Copy it from the browser address bar.'); }
    if (!LINK_SITE[channel].test(parsed.hostname)) throw new Error('That link is not from this site');
    // Keep just the page: tracking and search parts of a copied link are dropped (dates are added when used).
    parsed.hash = ''; parsed.search = '';
    links[channel] = parsed.toString();
    // Expedia Collect and Hotel Collect are the same Expedia page.
    if (channel === 'expedia_collect' || channel === 'expedia_hotel') { links.expedia_collect = links[channel]; links.expedia_hotel = links[channel]; }
  }
  await setSetting('channel_links', links);
}

/** The listing link with the dates and guests filled in, so the site shows the price for exactly that stay. */
export function siteSearchUrl(channel: ChannelKey, link: string | undefined, checkIn: string, checkOut: string, guests = 1) {
  if (!link) return null;
  let u: URL;
  try { u = new URL(link); } catch { return null; }
  const set = (o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) u.searchParams.set(k, v); };
  if (channel === 'booking_com') set({ checkin: checkIn, checkout: checkOut, group_adults: String(guests), no_rooms: '1', group_children: '0', selected_currency: 'EGP' });
  else if (channel === 'airbnb') set({ check_in: checkIn, check_out: checkOut, adults: String(guests) });
  else if (channel === 'hostelworld') set({ from: checkIn, to: checkOut, guests: String(guests) });
  else if (channel === 'expedia_collect' || channel === 'expedia_hotel') set({ chkin: checkIn, chkout: checkOut, rm1: `a${guests}` });
  else if (channel === 'agoda') set({ checkIn, los: String(Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 864e5))), adults: String(guests), rooms: '1', currency: 'EGP' });
  else return null;
  return u.toString();
}

export async function latestPrices(channel: ChannelKey) {
  const key = channel === 'expedia_hotel' ? 'expedia_collect' : channel;
  return q<any>(`SELECT stay_date, room, price_cents, currency, checked_at FROM site_prices WHERE channel=$1 AND stay_date >= $2 ORDER BY stay_date, price_cents LIMIT 40`, [key, todayLocal()]);
}

const amount = (s: string) => { const m = s.replace(/[ \s]/g, ' ').match(/(\d[\d,.\s]*\d|\d)/); if (!m) return null; const n = Number(m[1].replace(/[,\s]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
const currencyOf = (s: string) => (/US\$|\$|USD/.test(s) ? 'USD' : /€|EUR/.test(s) ? 'EUR' : 'EGP');

/** Reads tonight's (and tomorrow's) prices from each saved link. Read-only: opens the public page, never clicks "reserve". */
export async function readSitePrices(page: any, log: (m: string) => void) {
  const links = await getLinks();
  const done = new Set<string>();
  const results: string[] = [];
  for (const ch of SITE_KEYS) {
    const link = links[ch];
    const key = ch === 'expedia_hotel' ? 'expedia_collect' : ch;
    if (!link || done.has(key)) continue;
    done.add(key);
    for (const d of [todayLocal(), addDays(todayLocal(), 1)]) {
      try {
        await page.goto(siteSearchUrl(ch, link, d, addDays(d, 1), 1)!, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(6000);
        const rows: { room: string; price: string }[] = ch === 'booking_com'
          ? await page.$$eval('table.hprt-table tbody tr', (trs: any[]) => {
              let room = '';
              return trs.map((tr) => {
                const r = tr.querySelector('.hprt-roomtype-icon-link, .hprt-roomtype-name');
                if (r) room = (r.textContent || '').trim();
                const p = tr.querySelector('.bui-price-display__value, .prco-valign-middle-helper, [data-testid="price-and-discounted-price"]');
                return { room, price: (p?.textContent || '').trim() };
              }).filter((x) => x.room && x.price);
            })
          : await page.$$eval('[data-testid*="price" i], [class*="price" i]', (els: any[]) => els.slice(0, 30).map((e) => {
              const box = e.closest('[data-testid*="room" i], [class*="room" i], li, article, section');
              const name = box?.querySelector('h2, h3, h4, [class*="title" i], [class*="name" i]')?.textContent || '';
              return { room: name.trim().slice(0, 80), price: (e.textContent || '').trim() };
            }).filter((x) => x.room && /\d/.test(x.price)));
        // Cheapest price per room
        const best = new Map<string, { cents: number; cur: string }>();
        for (const r of rows) { const c = amount(r.price); if (c == null) continue; const p = best.get(r.room); if (!p || c < p.cents) best.set(r.room, { cents: c, cur: currencyOf(r.price) }); }
        await q(`DELETE FROM site_prices WHERE channel=$1 AND stay_date=$2`, [key, d]);
        for (const [room, v] of best) await q(`INSERT INTO site_prices(channel,stay_date,room,price_cents,currency) VALUES($1,$2,$3,$4,$5)`, [key, d, room, v.cents, v.cur]);
        results.push(`${key} ${d}: ${best.size} rooms`);
      } catch (e) { results.push(`${key} ${d}: ${(e as Error).message.slice(0, 120)}`); }
    }
  }
  if (results.length) { log('site prices: ' + results.join(' | ')); await setSetting('site_prices_status', { at: new Date().toISOString(), results }); }
  return results;
}
