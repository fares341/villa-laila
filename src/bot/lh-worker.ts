// Little Hotelier reader (read-only). Run with `npm run lh:sync`; docker-compose runs it as the "lh-reader" service.
// Signs in once (session kept on disk), then reads the bookings every LH_SYNC_EVERY_SEC seconds (default 60).
import { env } from '@/lib/env';
import { openBrowser, lhEnv } from '@/services/lh-reader/browser';
import { readOnce, notifyOwner, writeMode } from '@/services/lh-reader/sync';
import { q } from '@/lib/db';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[lh-reader]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!env.databaseUrl) throw new Error('DATABASE_URL not set');
  if (!lhEnv.email || !lhEnv.password) { log('LH_EMAIL / LH_PASSWORD not set: reader is off.'); for (;;) await sleep(3600_000); }
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
