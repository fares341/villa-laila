'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CUR_COOKIE, currencyForTimeZone } from '@/lib/display-currency';

/**
 * Sets the display currency from the browser's time zone (Egypt → EGP, Europe → EUR, elsewhere → USD) and,
 * when it differs from what the page was drawn with, redraws the page once.
 */
export function CurrencySync({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return; }
    const want = currencyForTimeZone(tz);
    if (!want) return;
    const saved = document.cookie.split('; ').find((c) => c.startsWith(CUR_COOKIE + '='))?.split('=')[1];
    if (saved === want) return;
    document.cookie = `${CUR_COOKIE}=${want}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    if (want !== current) router.refresh();
  }, [current, router]);
  return null;
}
