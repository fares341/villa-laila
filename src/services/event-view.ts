import { addDays, todayLocal } from '@/lib/dates';
import { scheduleLabel, timeLabel, dateLabel } from '@/lib/event-dates';
import type { EventCard } from '@/components/events-section';
import { tr, type PublicEvent } from './events';

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

export function toEventCard(e: PublicEvent, lang: string): EventCard {
  const today = todayLocal();
  return {
    slug: e.slug,
    title: tr(e.title, lang),
    summary: tr(e.summary, lang),
    image: e.image,
    price: priceLabel(e.price_cents, e.currency, lang),
    schedule: scheduleLabel(e, lang, (d) => dateLabel(d, lang)),
    time: `${timeLabel(e.start_time, lang)} – ${timeLabel(e.end_time, lang)}`,
    next: e.nextDate ? whenLabel(e.nextDate, lang) : '',
    soon: !!e.nextDate && (e.nextDate === today || e.nextDate === addDays(today, 1)),
  };
}
