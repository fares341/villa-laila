import { cookies, headers } from 'next/headers';
import { getRates } from './pms/fx';
import { CUR_COOKIE, FX_FALLBACK, currencyForAcceptLanguage, isDisplayCurrency, type DisplayCurrency, type Fx } from '@/lib/display-currency';

export type PriceView = { cur: DisplayCurrency; fx: Fx };

/** The visitor's display currency (cookie from <CurrencySync/>, else Accept-Language) and today's EGP rates. */
export async function visitorPriceView(): Promise<PriceView> {
  const [jar, h, rates] = await Promise.all([cookies(), headers(), getRates().catch(() => null)]);
  const saved = jar.get(CUR_COOKIE)?.value;
  const cur: DisplayCurrency = isDisplayCurrency(saved) ? saved : currencyForAcceptLanguage(h.get('accept-language')) ?? 'USD';
  const fx: Fx = { USD: Number(rates?.USD) > 0 ? Number(rates!.USD) : FX_FALLBACK.USD, EUR: Number(rates?.EUR) > 0 ? Number(rates!.EUR) : FX_FALLBACK.EUR };
  return { cur, fx };
}
