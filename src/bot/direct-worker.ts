// Booking-engine price reader. Run with `npm run direct:sync`; docker-compose runs it as the "direct-reader" service.
// Opens the hostel's public direct-book.com page night by night and keeps room prices and availability in
// direct_prices (see services/direct-book.ts). Its own headless Chrome, separate from the Little Hotelier reader,
// so one failing never stops the other.
import { env } from '@/lib/env';
import { lhEnv } from '@/services/lh-reader/browser';
import { readDirectBook } from '@/services/direct-book';
import { pushQueue, pushMode } from '@/services/direct-book-push';
import { setSetting } from '@/services/settings';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[direct-reader]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function main() {
  if (!env.databaseUrl) throw new Error('DATABASE_URL not set');
  if (process.env.DIRECT_BOOK_OFF === '1') { log('DIRECT_BOOK_OFF=1: not reading'); for (;;) await sleep(3600_000); }
  const every = Math.max(5, Number(process.env.DIRECT_BOOK_EVERY_MIN || 15)) * 60_000;
  const { chromium } = await import('playwright-core');
  log(`starting, prices every ${every / 60_000} min, booking copies ${pushMode()}, chrome at ${lhEnv.chromium}`);
  let lastPrices = 0;
  for (;;) {
    const t0 = Date.now();
    const pricesDue = Date.now() - lastPrices >= every;
    let browser: any = null;
    try {
      // Bookings waiting to be copied into direct-book: checked every minute.
      const waiting = pushMode() === 'off' ? 0 : Number((await (await import('@/lib/db')).q<any>(`SELECT count(*)::int n FROM direct_book_pushes WHERE status='queued' OR (status='failed' AND attempts < 3 AND updated_at < now() - interval '20 minutes')`).catch(() => [{ n: 0 }]))[0]?.n ?? 0);
      if (pricesDue || waiting) {
        browser = await chromium.launch({ executablePath: lhEnv.chromium, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
        const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'Africa/Cairo', viewport: { width: 1366, height: 900 } });
        if (waiting) { const p = await ctx.newPage(); await pushQueue(p, log); await p.close().catch(() => {}); }
        if (pricesDue) {
          lastPrices = Date.now();
          const page = await ctx.newPage();
          const r = await readDirectBook(page, log, Number(process.env.DIRECT_BOOK_PER_RUN || 30));
          if (!r.read && r.errors.length) log('nothing read:', r.errors.slice(0, 3).join(' | '));
        }
      }
    } catch (e) {
      log('failed:', (e as Error).message);
      await setSetting('direct_book_status', { at: new Date().toISOString(), read: 0, errors: [(e as Error).message.slice(0, 300)] }).catch(() => {});
    } finally {
      await browser?.close().catch(() => {});
    }
    await sleep(Math.max(15_000, 60_000 - (Date.now() - t0)));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
