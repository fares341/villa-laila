// Copy one website booking into direct-book by hand, to test the script on the server:
//   docker compose exec direct-reader npm run direct:push -- VL-XXXXXX
// Uses DIRECT_BOOK_PUSH from .env (dry: fills everything and stops before the last button; on: books).
// Screenshots: uploads/direct-book/<reference>/
import { q } from '@/lib/db';
import { lhEnv } from '@/services/lh-reader/browser';
import { pushOne, pushMode } from '@/services/direct-book-push';

async function main() {
  const ref = String(process.argv[2] || '').toUpperCase();
  if (!ref) { console.error('usage: npm run direct:push -- VL-XXXXXX'); process.exit(1); }
  const r = (await q<any>(`SELECT id FROM reservations WHERE reference=$1`, [ref]))[0];
  if (!r) { console.error('no booking', ref); process.exit(1); }
  if (pushMode() === 'off') { console.error('DIRECT_BOOK_PUSH is off: set it to dry (test) or on in .env'); process.exit(1); }
  await q(`INSERT INTO direct_book_pushes(reservation_id,status,message) VALUES($1,'queued','by hand') ON CONFLICT (reservation_id) DO UPDATE SET status='queued', updated_at=now()`, [r.id]);
  const { chromium } = await import('playwright-core');
  const b = await chromium.launch({ executablePath: lhEnv.chromium, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', locale: 'en-US', timezoneId: 'Africa/Cairo', viewport: { width: 1366, height: 900 } });
  const status = await pushOne(await ctx.newPage(), r.id, console.log);
  const p = (await q<any>(`SELECT message, steps FROM direct_book_pushes WHERE reservation_id=$1`, [r.id]))[0];
  console.log(`\n${ref} (${pushMode()}): ${status} · ${p.message}`);
  for (const s of p.steps ?? []) console.log(` ${s.ok ? 'OK  ' : 'FAIL'} ${s.step}${s.note ? ' · ' + s.note : ''}`);
  await b.close();
  process.exit(status === 'failed' ? 1 : 0);
  }

main().catch((e) => { console.error(e); process.exit(1); });
