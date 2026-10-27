// Little Hotelier reader (read-only). Run with `npm run lh:sync`; docker-compose runs it as the "lh-reader" service.
// Signs in once (session kept on disk), then reads the bookings every LH_SYNC_EVERY_SEC seconds (default 60).
// Also reads the current prices from the hostel's public listing pages (links saved in Bookings from sites), once an hour.
import { env } from '@/lib/env';
import { openBrowser, lhEnv } from '@/services/lh-reader/browser';
import { readOnce, notifyOwner, writeMode } from '@/services/lh-reader/sync';
import { q } from '@/lib/db';
import { readSitePrices, getLinks } from '@/services/site-prices';
import { readDirectBook } from '@/services/direct-book';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[lh-reader]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!env.databaseUrl) throw new Error('DATABASE_URL not set');
  const priceEvery = Math.max(15, Number(process.env.SITE_PRICE_EVERY_MIN || 60)) * 60_000;
  let lastPrices = 0;
  // The hostel's booking engine (direct-book.com): room prices for the website, every DIRECT_BOOK_EVERY_MIN (default 20).
  const directEvery = Math.max(5, Number(process.env.DIRECT_BOOK_EVERY_MIN || 20)) * 60_000;
  const directOn = process.env.DIRECT_BOOK_OFF !== '1';
  let lastDirect = 0;
  const direct = async (page: any) => {
    if (!directOn || Date.now() - lastDirect < directEvery) return;
    lastDirect = Date.now();
    const tab = await page.context().newPage();
    try { await readDirectBook(tab, log); } catch (e) { log('direct-book failed:', (e as Error).message); } finally { await tab.close().catch(() => {}); }
  };
  const prices = async (page: any) => {
    await direct(page);
    if (Date.now() - lastPrices < priceEvery) return;
    lastPrices = Date.now();
    if (!Object.keys(await getLinks()).length) return;
    // A separate tab, so the Little Hotelier session page stays as it is.
    const tab = await page.context().newPage();
    try { await readSitePrices(tab, log); } catch (e) { log('site prices failed:', (e as Error).message); } finally { await tab.close().catch(() => {}); }
  };
  if (!lhEnv.email || !lhEnv.password) {
    log('LH_EMAIL / LH_PASSWORD not set: Little Hotelier reading is off; only prices are read (booking engine + site links).');
    for (;;) {
      if (directOn || Object.keys(await getLinks().catch(() => ({}))).length) {
        const b = await openBrowser().catch((e) => { log('browser error:', e.message); return null; });
        if (b) { await prices(b.page); await b.ctx.close().catch(() => {}); }
      }
      await sleep(Math.min(priceEvery, directEvery));
    }
  }
  const every = Math.max(30, Number(process.env.LH_SYNC_EVERY_SEC || 60)) * 1000;
  log(`starting, every ${every / 1000}s, ${writeMode() ? 'WRITE mode' : 'TEST mode (nothing saved)'}`);
  let fails = 0;
  for (;;) {
    let browser: Awaited<ReturnType<typeof openBrowser>> | null = null;
    const opened = Date.now();
    try {
      browser = await openBrowser();
      // Re-open the browser every 6 hours so memory stays low.
      while (Date.now() - opened < 6 * 3600_000) {
        const t0 = Date.now();
        try {
          const n = await readOnce(browser.page, log);
          if (fails >= 3) await notifyOwner('Little Hotelier reader is working again.');
          fails = 0;
          if (n.imported || n.cancelled) log(`found ${n.found}, imported ${n.imported}, cancelled ${n.cancelled}`);
          await prices(browser.page);
        } catch (e) {
          fails++;
          log('read failed:', (e as Error).message);
          await q(`INSERT INTO lh_runs(ok,message) VALUES(false,$1)`, [(e as Error).message.slice(0, 500)]).catch(() => {});
          if (fails === 3) await notifyOwner(`Little Hotelier reader failed 3 times in a row: ${(e as Error).message}. Add new site bookings by hand until it works again.`);
          await sleep(fails >= 3 ? 10 * 60_000 : 60_000);
          if (fails % 3 === 0) break; // restart the browser
        }
        await sleep(Math.max(5000, every - (Date.now() - t0)));
      }
    } catch (e) {
      log('browser error:', (e as Error).message);
      await sleep(5 * 60_000);
    } finally {
      await browser?.ctx.close().catch(() => {});
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
