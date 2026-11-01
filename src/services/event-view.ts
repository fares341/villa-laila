import { showPrice } from '@/lib/display-currency';
import type { PriceView } from './visitor-currency';
import { addDays, todayLocal } from '@/lib/dates';
import { scheduleLabel, timeLabel, dateLabel } from '@/lib/event-dates';
import type { EventCard } from '@/components/events-section';
import { tr, type PublicEvent } from './events';
import { listCollabs } from './collabs';

export function priceLabel(cents: number, currency: string, lang: string) {
  const v = (cents / 100).toLocaleString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { maximumFractionDigits: 2 });
  if (lang === 'ar' && currency === 'EGP') return `${v} ج.م`;
  return `${currency} ${v}`;
}

export function whenLabel(date: string, lang: string) {
  const today = todayLocal();
  if (date === today) return lang === 'ar' ? 'اليوم' : 'Today';
  if (date === addDays(today, 1)) return lang === 'ar' ? 'غدًا' : 'Tomorrow';
  return dateLabel(date, lang);
}

export function toEventCard(e: PublicEvent, lang: string, view?: PriceView): EventCard {
  const today = todayLocal();
  return {
    slug: e.slug,
    title: tr(e.title, lang),
    summary: tr(e.summary, lang),
    image: e.image,
    price: view ? showPrice(e.price_cents, e.currency, view, lang) : priceLabel(e.price_cents, e.currency, lang),
    schedule: scheduleLabel(e, lang, (d) => dateLabel(d, lang)),
    time: `${timeLabel(e.start_time, lang)} – ${timeLabel(e.end_time, lang)}`,
    next: e.nextDate ? whenLabel(e.nextDate, lang) : '',
    soon: !!e.nextDate && (e.nextDate === today || e.nextDate === addDays(today, 1)),
    soldOut: !!e.soldOut,
    left: e.seatsLeftNext ?? null,
  };
}

/** Upcoming collab events as cards that look exactly like the villa's own events (they open the collab page). */
export async function collabCards(lang: string): Promise<{ card: EventCard; date: string }[]> {
  const today = todayLocal();
  const ar = lang === 'ar';
  const t = (x: { ar?: string; en?: string } | undefined) => (ar ? x?.ar || x?.en : x?.en || x?.ar) || '';
  const plain = (s: string) => s.split(/\n+/).map((l) => l.replace(/^\s*(#+|-|\*)\s*/, '').replace(/\*\*|__|\*|_/g, '').trim()).filter(Boolean).map((l) => (/[.!?؟:،,]$/.test(l) ? l : l + '.')).join(' ');
  return (await listCollabs())
    .filter((c) => c.active && (!c.event_date || c.event_date >= today))
    .sort((a, b) => (a.event_date ?? '9999').localeCompare(b.event_date ?? '9999'))
    .map((c) => {
      const left = c.capacity == null ? null : Math.max(0, c.capacity - c.people);
      const d = c.event_date ?? '';
      return {
        date: d,
        card: {
          slug: `c-${c.slug}`,
          href: `/c/${c.slug}?lang=${lang}`,
          partner: c.partner_name,
          title: t(c.title),
          summary: plain(t(c.description)).slice(0, 180),
          image: c.photos[0] ?? c.partner_logo,
          price: t(c.price_note) || (ar ? 'مجانًا' : 'Free'),
          schedule: `Villa Layla & ${c.partner_name}`,
          time: [c.start_time, c.end_time].filter(Boolean).map((x) => timeLabel(x!, lang)).join(' – '),
          next: d ? whenLabel(d, lang) : ar ? 'قريبًا' : 'Coming soon',
          soon: !!d && (d === today || d === addDays(today, 1)),
          soldOut: left === 0,
          left,
        },
      };
    });
}

/** Puts the collab cards in the middle of the villa's events (within the first `limit` cards when the list is cut). */
export async function withCollabs(events: EventCard[], lang: string, limit?: number): Promise<EventCard[]> {
  const collabs = await collabCards(lang).catch(() => []);
  if (!collabs.length) return events;
  const out = [...events];
  const room = limit ? Math.min(out.length, Math.max(0, limit - collabs.length)) : out.length;
  out.splice(Math.ceil(room / 2), 0, ...collabs.map((c) => c.card));
  return out;
}

/**
 * "More at the villa" under a collab event: the villa's events and the other collabs. Events that run on the
 * collab's own day come first (badge "Same day", their link opens that date); the rest in their usual order.
 */
export async function moreEventsFor(collab: { slug: string; event_date: string | null }, lang: string, view?: PriceView): Promise<EventCard[]> {
  const ar = lang === 'ar';
  const { listPublicEvents } = await import('./events');
  const day = collab.event_date;
  const today = todayLocal();
  const same: EventCard[] = [], rest: EventCard[] = [];
  for (const e of await listPublicEvents().catch(() => [])) {
    const card = toEventCard(e, lang, view);
    if (day && day >= today && e.dates.includes(day)) {
      same.push({ ...card, hl: true, left: null, soldOut: false, badge: `${ar ? 'نفس اليوم' : 'Same day'} · ${dateLabel(day, lang)}`, href: `/${lang}/events/${e.slug}?date=${day}#book` });
    } else if (e.nextDate) rest.push(card);
  }
  for (const { card, date } of await collabCards(lang).catch(() => [])) {
    if (card.href?.startsWith(`/c/${collab.slug}?`)) continue;
    if (day && date === day) same.push({ ...card, hl: true, badge: `${ar ? 'نفس اليوم' : 'Same day'} · ${dateLabel(day, lang)}` });
    else rest.push(card);
  }
  return [...same, ...rest];
}
