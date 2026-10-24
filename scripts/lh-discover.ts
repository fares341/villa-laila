// One-time discovery run (read-only): signs in to Little Hotelier, opens the main pages, and writes a report of
// which pages load bookings and what the data looks like (personal data hidden). The report and screenshots are
// saved under uploads/lh-discovery and sent to the owner's Telegram admin bot.
//   docker compose run --rm lh-reader npm run lh:discover
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, capture, ensureSignedIn, lhEnv } from '@/services/lh-reader/browser';
import { extractBookings, dedupe, redact } from '@/services/lh-reader/extract';
import { notifyOwner } from '@/services/lh-reader/sync';
import { UPLOAD_DIR } from '@/lib/uploads';

const out = path.join(UPLOAD_DIR, 'lh-discovery');
const log = (...a: unknown[]) => console.log('[discover]', ...a);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const { ctx, page } = await openBrowser();
  const report: any = { at: new Date().toISOString(), pages: [] as any[] };
  try {
    await page.goto(lhEnv.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!(await ensureSignedIn(page, log, notifyOwner))) throw new Error('could not sign in');
    const visit = async (label: string, go: () => Promise<unknown>) => {
      const caps = await capture(page, go, 10000);
      const shot = path.join(out, `${report.pages.length + 1}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      const found = dedupe(caps.flatMap((c) => extractBookings(c.json)));
      report.pages.push({
        label, url: page.url(), screenshot: path.basename(shot), bookingsFound: found.length,
        bookingsSample: found.slice(0, 3).map((b) => ({ channel: b.channel, status: b.status, checkIn: b.checkIn, checkOut: b.checkOut, roomType: b.roomType, guests: b.guests, total: b.total, currency: b.currency, payment: b.paymentNote, refLength: b.ref.length })),
        responses: caps.map((c) => ({ url: c.url.replace(/([?&](token|key|auth|session)[^&]*)/gi, ''), status: c.status, sample: redact(c.json) })),
      });
      log(`${label}: ${page.url()} · ${caps.length} data responses · ${found.length} bookings`);
    };
    await visit('home', () => page.waitForTimeout(500));
    // Follow the menu links that look like bookings pages (GET only, nothing is clicked or changed).
    const links: { href: string; text: string }[] = await page.$$eval('a[href]', (as: any[]) => as.map((a) => ({ href: a.href, text: (a.innerText || '').trim() })));
    const wanted = links.filter((l) => /reserv|booking|front.?desk|arriv|calendar|inventory|guest/i.test(`${l.href} ${l.text}`)).filter((l, i, a) => a.findIndex((x) => x.href === l.href) === i).slice(0, 8);
    report.menuLinks = links.filter((l) => l.text).slice(0, 80).map((l) => ({ text: l.text.slice(0, 40), href: l.href }));
    for (const l of wanted) await visit(l.text || l.href, () => page.goto(l.href, { waitUntil: 'domcontentloaded', timeout: 45000 }));
    if (lhEnv.bookingsUrl) await visit('LH_BOOKINGS_URL', () => page.goto(lhEnv.bookingsUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }));
  } catch (e) {
    report.error = (e as Error).message;
  } finally {
    const file = path.join(out, 'report.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(out, 'last.png') }).catch(() => {});
    await ctx.close().catch(() => {});
    const best = [...(report.pages ?? [])].sort((a: any, b: any) => b.bookingsFound - a.bookingsFound)[0];
    const msg = report.error ? `Little Hotelier discovery failed: ${report.error}` : `Little Hotelier discovery done. Best page: ${best?.label} (${best?.bookingsFound ?? 0} bookings) ${best?.url ?? ''}. Report saved on the server in uploads/lh-discovery/report.json.`;
    log(msg);
    await notifyOwner(msg);
    try {
      const { getAdminBotConfig, adminApi } = await import('@/services/admin-bot');
      const { chat_ids } = await getAdminBotConfig();
      for (const id of chat_ids) await adminApi.document(id, fs.readFileSync(file), 'lh-discovery-report.json', 'Little Hotelier discovery report (personal data hidden)').catch(() => {});
    } catch { /* ignore */ }
    process.exit(report.error ? 1 : 0);
  }
})();
