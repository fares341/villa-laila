// Pure date logic for repeating events (no DB). Dates are 'YYYY-MM-DD' calendar days in the hostel timezone.
import { addDays, todayLocal } from './dates';
import { env } from './env';

export type Schedule = {
  recurrence: 'daily' | 'weekly' | 'once';
  weekdays: number[];        // 0=Sun … 6=Sat
  once_date: string | null;
  ends_on?: string | null;
  start_time: string;        // HH:MM
  end_time: string;          // HH:MM
};

/** 'HH:MM' wall clock in the hostel timezone right now. */
export function nowHHMM(now: Date = new Date(), tz = env.tz): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

const weekday = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();

/** Next `count` dates the event runs, starting today. Today is skipped once the event has ended. */
export function upcomingDates(s: Schedule, count = 30, now: Date = new Date(), horizonDays = 120): string[] {
  const today = todayLocal(now);
  const time = nowHHMM(now);
  const open = (d: string) => d > today || (d === today && time < s.end_time);
  if (s.recurrence === 'once') return s.once_date && open(s.once_date) ? [s.once_date] : [];
  const out: string[] = [];
  for (let i = 0; i <= horizonDays && out.length < count; i++) {
    const d = addDays(today, i);
    if (s.ends_on && d > s.ends_on) break;
    if (s.recurrence === 'weekly' && !s.weekdays.includes(weekday(d))) continue;
    if (open(d)) out.push(d);
  }
  return out;
}

export function isBookableDate(s: Schedule, date: string, now: Date = new Date()): boolean {
  return upcomingDates(s, 400, now, 180).includes(date);
}

const DAY_NAMES: Record<string, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};

/** 'Daily', 'Wed & Sat', 'Mon–Sat' … */
export function scheduleLabel(s: Schedule, lang: string, fmtDate: (d: string) => string): string {
  const ar = lang === 'ar';
  if (s.recurrence === 'daily') return ar ? 'يوميًا' : 'Daily';
  if (s.recurrence === 'once') return s.once_date ? fmtDate(s.once_date) : '';
  const names = DAY_NAMES[ar ? 'ar' : 'en'];
  const days = [...s.weekdays].sort((a, b) => a - b);
  const consecutive = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive) return `${names[days[0]]}–${names[days[days.length - 1]]}`;
  return days.map((d) => names[d]).join(ar ? ' و' : ' & ');
}

/** '8:00 AM' / '٨:٠٠ ص' style label for an 'HH:MM' value. */
export function timeLabel(hhmm: string, lang: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

export function dateLabel(iso: string, lang: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang, { ...opts, timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
}
