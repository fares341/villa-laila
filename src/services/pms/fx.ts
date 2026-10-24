import { getSetting, setSetting } from '../settings';
import { BookingError } from '../errors';

/**
 * EGP exchange rates for cash taken in USD / EUR and for the USD taxi prices.
 * Refreshed from a free public source (open.er-api.com) a few times a day; a manager can set them by hand,
 * and a manual rate is kept until the end of that day.
 */
export type Currency = 'EGP' | 'USD' | 'EUR';
export const CURRENCIES: Currency[] = ['EGP', 'USD', 'EUR'];
export type Rates = { USD: number | null; EUR: number | null; source: 'auto' | 'manual' | 'none'; updated_at?: string };

export async function getRates(): Promise<Rates> {
  const r = await getSetting<Rates>('fx_rates').catch(() => null);
  return { USD: r?.USD ?? null, EUR: r?.EUR ?? null, source: r?.source ?? 'none', updated_at: r?.updated_at };
}

export async function setManualRates(usd: number, eur: number) {
  if (!(usd > 1 && eur > 1)) throw new BookingError('INVALID_INPUT', 'Enter both rates in EGP');
  await setSetting('fx_rates', { USD: Math.round(usd * 10000) / 10000, EUR: Math.round(eur * 10000) / 10000, source: 'manual', updated_at: new Date().toISOString() });
}

/** Pull today's market rate. Keeps a manual rate set today. Never throws. */
export async function refreshRates(force = false): Promise<Rates> {
  const cur = await getRates();
  const today = new Date().toISOString().slice(0, 10);
  if (!force && cur.source === 'manual' && cur.updated_at?.slice(0, 10) === today) return cur;
  if (!force && cur.source === 'auto' && cur.updated_at && Date.now() - Date.parse(cur.updated_at) < 4 * 3600e3) return cur;
  const g = globalThis as unknown as { __fxTry?: number };
  if (!force && g.__fxTry && Date.now() - g.__fxTry < 30 * 60000) return cur; // don't hammer the source when it is down
  g.__fxTry = Date.now();
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const j: any = await res.json();
    const egp = Number(j?.rates?.EGP), eur = Number(j?.rates?.EUR);
    if (!(egp > 1 && eur > 0)) throw new Error('bad response');
    const next: Rates = { USD: Math.round(egp * 10000) / 10000, EUR: Math.round((egp / eur) * 10000) / 10000, source: 'auto', updated_at: new Date().toISOString() };
    await setSetting('fx_rates', next);
    return next;
  } catch (e) {
    console.error('[fx] refresh failed', (e as Error).message);
    return cur;
  }
}

export async function rateFor(cur: Currency): Promise<number> {
  if (cur === 'EGP') return 1;
  let r = await getRates();
  if (r[cur] == null) r = await refreshRates(true);
  const v = r[cur];
  if (!v) throw new BookingError('BAD_STATE', `No ${cur} rate yet. Set today's rate in Shifts & cash.`);
  return v;
}

/** minor units of `cur` -> EGP piastres, and back (rounded up to the next whole unit so the guest never pays short). */
export const toEgp = (minor: number, rate: number) => Math.round(minor * rate);
export const fromEgp = (egpCents: number, rate: number) => Math.ceil(egpCents / rate / 100) * 100;
export const fmtCur = (minor: number, cur: string) => `${cur} ${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
