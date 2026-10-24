import { getSetting, setSetting } from '../settings';
import { BookingError } from '../errors';

/**
 * EGP exchange rates for cash taken in USD / EUR and for the USD taxi prices.
 * Refreshed from a free public source (open.er-api.com) a few times a day; a manager can set them by hand,
 * and a manual rate is kept until the end of that day.
 */
export type Currency = 'EGP' | 'USD' | 'EUR';
export const CURRENCIES: Currency[] = ['EGP', 'USD', 'EUR'];
/** Cash in other currencies is rare; these can be picked on the POS ("Other"), at today's market rate. */
export const OTHER_CURRENCIES: Record<string, string> = {
  GBP: 'British pound', SAR: 'Saudi riyal', AED: 'UAE dirham', KWD: 'Kuwaiti dinar', QAR: 'Qatari riyal', BHD: 'Bahraini dinar', OMR: 'Omani rial', JOD: 'Jordanian dinar',
  CHF: 'Swiss franc', CAD: 'Canadian dollar', AUD: 'Australian dollar', NZD: 'New Zealand dollar', JPY: 'Japanese yen', CNY: 'Chinese yuan', KRW: 'Korean won',
  TRY: 'Turkish lira', RUB: 'Russian ruble', SEK: 'Swedish krona', NOK: 'Norwegian krone', DKK: 'Danish krone', PLN: 'Polish zloty', CZK: 'Czech koruna',
  HUF: 'Hungarian forint', INR: 'Indian rupee', MAD: 'Moroccan dirham', TND: 'Tunisian dinar', ZAR: 'South African rand', BRL: 'Brazilian real', MXN: 'Mexican peso',
};
export const isCashCurrency = (c: unknown): c is string => typeof c === 'string' && (c === 'EGP' || c === 'USD' || c === 'EUR' || c in OTHER_CURRENCIES);
export type Rates = { USD: number | null; EUR: number | null; others?: Record<string, number>; source: 'auto' | 'manual' | 'none'; updated_at?: string };

export async function getRates(): Promise<Rates> {
  const r = await getSetting<Rates>('fx_rates').catch(() => null);
  return { USD: r?.USD ?? null, EUR: r?.EUR ?? null, others: r?.others ?? {}, source: r?.source ?? 'none', updated_at: r?.updated_at };
}

export async function setManualRates(usd: number, eur: number) {
  if (!(usd > 1 && eur > 1)) throw new BookingError('INVALID_INPUT', 'Enter both rates in EGP');
  const cur = await getRates();
  await setSetting('fx_rates', { USD: Math.round(usd * 10000) / 10000, EUR: Math.round(eur * 10000) / 10000, others: cur.others ?? {}, source: 'manual', updated_at: new Date().toISOString() });
}

/** A manager sets the rate of a rare currency by hand (used when the market source has none). */
export async function setOtherRate(code: string, egpPerUnit: number) {
  if (!(code in OTHER_CURRENCIES)) throw new BookingError('INVALID_INPUT', 'Unknown currency');
  if (!(egpPerUnit > 0)) throw new BookingError('INVALID_INPUT', 'Enter the rate in EGP');
  const cur = await getRates();
  await setSetting('fx_rates', { ...cur, others: { ...(cur.others ?? {}), [code]: Math.round(egpPerUnit * 10000) / 10000 } });
}

/** Pull today's market rate. Keeps a manual rate set today. Never throws. */
export async function refreshRates(force = false, keepBase = false): Promise<Rates> {
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
    const others: Record<string, number> = {};
    for (const code of Object.keys(OTHER_CURRENCIES)) { const x = Number(j?.rates?.[code]); if (x > 0) others[code] = Math.round((egp / x) * 10000) / 10000; }
    // A manual USD/EUR rate set today stays; the rare currencies always follow the market.
    const keepManual = keepBase && cur.source === 'manual' && cur.updated_at?.slice(0, 10) === today;
    const next: Rates = keepManual ? { ...cur, others } : { USD: Math.round(egp * 10000) / 10000, EUR: Math.round((egp / eur) * 10000) / 10000, others, source: 'auto', updated_at: new Date().toISOString() };
    await setSetting('fx_rates', next);
    return next;
  } catch (e) {
    console.error('[fx] refresh failed', (e as Error).message);
    return cur;
  }
}

export async function rateFor(cur: string): Promise<number> {
  if (cur === 'EGP') return 1;
  if (!isCashCurrency(cur)) throw new BookingError('INVALID_INPUT', `Unknown currency ${cur}`);
  const pick = (r: Rates) => (cur === 'USD' || cur === 'EUR' ? r[cur] : r.others?.[cur] ?? null);
  let r = await getRates();
  // Fetching a rare currency must not overwrite a USD / EUR rate set by hand today.
  if (pick(r) == null) r = await refreshRates(true, cur !== 'USD' && cur !== 'EUR');
  const v = pick(r);
  if (!v) throw new BookingError('BAD_STATE', `No ${cur} rate yet. Set today's rate in Shifts & cash.`);
  return v;
}

/** minor units of `cur` -> EGP piastres, and back (rounded up to the next whole unit so the guest never pays short). */
export const toEgp = (minor: number, rate: number) => Math.round(minor * rate);
export const fromEgp = (egpCents: number, rate: number) => Math.ceil(egpCents / rate / 100) * 100;
export const fmtCur = (minor: number, cur: string) => `${cur} ${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
