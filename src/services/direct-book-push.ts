import path from 'node:path';
import fs from 'node:fs';
import { q } from '@/lib/db';
import { UPLOAD_DIR } from '@/lib/uploads';
import { audit } from './audit';
import { directBookUrl, directNameFor } from './direct-book';

/**
 * Copies a website booking into the hostel's booking engine (direct-book.com) with the guest's details, so the
 * booking lands in Little Hotelier and the beds close on every channel. Run by the direct-reader service.
 *
 *   DIRECT_BOOK_PUSH        off (default) | dry | on
 *                           dry: goes through every step and fills everything, then stops before the final button
 *                           on:  also presses the final button and saves direct-book's booking reference
 *   DIRECT_BOOK_CARD_NUMBER / DIRECT_BOOK_CARD_NAME / DIRECT_BOOK_CARD_EXPIRY (MM/YY) / DIRECT_BOOK_CARD_CVC
 *                           the hotel's own card the engine asks for (it is not charged). Server .env only:
 *                           never stored in the database, never logged, never shown.
 *
 * Screenshots of each step: uploads/direct-book/<booking reference>/
 */
export const pushMode = (): 'off' | 'dry' | 'on' => {
  const m = String(process.env.DIRECT_BOOK_PUSH || 'off').toLowerCase();
  return m === 'on' || m === 'dry' ? m : 'off';
};
const card = () => ({
  number: (process.env.DIRECT_BOOK_CARD_NUMBER || '').replace(/\s+/g, ''),
  name: process.env.DIRECT_BOOK_CARD_NAME || '',
  expiry: process.env.DIRECT_BOOK_CARD_EXPIRY || '',
  cvc: process.env.DIRECT_BOOK_CARD_CVC || '',
});
const cardSet = () => { const c = card(); return !!(c.number && c.expiry && c.cvc); };

/** Put a booking in the queue (reception confirmed it, or its deposit was paid). Safe to call twice. */
export async function queueDirectBooking(reservationId: string, why: string) {
  if (pushMode() === 'off') return;
  await q(`INSERT INTO direct_book_pushes(reservation_id,status,message) VALUES($1,'queued',$2)
           ON CONFLICT (reservation_id) DO UPDATE SET status='queued', message=EXCLUDED.message, updated_at=now()
           WHERE direct_book_pushes.status IN ('failed','dry_ok')`, [reservationId, why]).catch((e) => console.error('[direct push queue]', e));
}

type Step = { step: string; ok: boolean; note?: string; shot?: string };
const COUNTRY = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; } })();

/** Fills a field found by its visible label (or placeholder). Returns false when it is not on the page. */
async function fill(page: any, label: RegExp, value: string | null | undefined) {
  if (!value) return true;
  const tries = [
    () => page.getByLabel(label).first(),
    () => page.getByPlaceholder(label).first(),
    () => page.locator('label, span').filter({ hasText: label }).first().locator('xpath=following::input[1]'),
  ];
  for (const t of tries) {
    try { const el = t(); if (await el.count() && await el.isVisible()) { await el.fill(''); await el.fill(value); return true; } } catch { /* next */ }
  }
  return false;
}

/** A search-select (country, arrival time): type, then pick the first matching option. */
async function choose(page: any, label: RegExp, text: string | null | undefined) {
  if (!text) return true;
  try {
    let el = page.getByLabel(label).first();
    if (!(await el.count())) el = page.getByPlaceholder(label).first();
    if (!(await el.count())) return false;
    await el.click();
    await el.fill(text);
    await page.waitForTimeout(500);
    const opt = page.getByRole('option', { name: new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if (await opt.count()) await opt.click(); else await el.press('Enter');
    return true;
  } catch { return false; }
}

/** Card fields may sit inside a payment iframe: look in every frame. */
async function fillCard(page: any) {
  const c = card();
  const frames = [page.mainFrame(), ...page.frames()];
  const want: [RegExp, string, string][] = [
    [/card ?number|cc-number|cardnumber|número/i, c.number, 'number'],
    [/name on card|card ?holder|cc-name|holder/i, c.name, 'name'],
    [/expir|exp-date|mm ?\/ ?yy|cc-exp/i, c.expiry, 'expiry'],
    [/cvc|cvv|security code|cc-csc/i, c.cvc, 'cvc'],
  ];
  const done: string[] = [];
  for (const [re, val, key] of want) {
    if (!val) continue;
    for (const f of frames) {
      try {
        const inputs = await f.$$('input');
        for (const i of inputs) {
          const attrs = await i.evaluate((n: any) => [n.name, n.id, n.placeholder, n.autocomplete, n.getAttribute('aria-label'), n.getAttribute('data-elements-stable-field-name')].filter(Boolean).join(' '));
          if (re.test(attrs) && await i.isVisible()) { await i.fill(''); await i.type(val, { delay: 40 }); done.push(key); break; }
        }
        if (done.includes(key)) break;
      } catch { /* frame gone */ }
    }
  }
  return done;
}

/** What inputs the page shows (labels / names only, never values), to adjust the script when the engine changes. */
async function fieldsOf(page: any) {
  const out: string[] = [];
  for (const f of [page.mainFrame(), ...page.frames()]) {
    try {
      const names = await f.$$eval('input, select, textarea, button', (els: any[]) => els.filter((e) => e.offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}:${e.getAttribute('aria-label') || e.name || e.id || e.placeholder || (e.innerText || '').trim().slice(0, 30)}`));
      out.push(...names.slice(0, 60).map((n: string) => (f === page.mainFrame() ? '' : '[frame] ') + n));
    } catch { /* ignore */ }
  }
  return [...new Set(out)];
}

/** One booking through the engine. */
export async function pushOne(page: any, reservationId: string, log: (m: string) => void) {
  const mode = pushMode();
  const r = (await q<any>(`SELECT r.*, g.full_name, g.email, g.phone, g.address, t.code, t.kind FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id WHERE r.id=$1`, [reservationId]))[0];
  const steps: Step[] = [];
  const dir = path.join(UPLOAD_DIR, 'direct-book', r?.reference ?? reservationId);
  fs.mkdirSync(dir, { recursive: true });
  const shot = async (name: string) => { const f = path.join(dir, `${steps.length + 1}-${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => {}); return path.relative(UPLOAD_DIR, f); };
  const finish = async (status: string, message: string, confirmation: string | null = null) => {
    await q(`UPDATE direct_book_pushes SET status=$2, message=$3, confirmation=COALESCE($4, confirmation), steps=$5, attempts=attempts+1, updated_at=now() WHERE reservation_id=$1`,
      [reservationId, status, message.slice(0, 500), confirmation, JSON.stringify(steps)]);
    await audit('direct-book', 'direct_book.' + status, 'reservation', reservationId, { message: message.slice(0, 200), confirmation });
    log(`push ${r?.reference ?? reservationId}: ${status} · ${message}`);
    return status;
  };
  if (!r) return finish('skipped', 'booking not found');
  if (!['pending', 'confirmed', 'checked_in'].includes(r.status)) return finish('skipped', `booking is ${r.status}`);
  const name = directNameFor(r.code);
  if (!name) return finish('failed', `room ${r.code} has no name on direct-book`);
  if (mode === 'on' && !cardSet()) return finish('failed', 'DIRECT_BOOK_CARD_* not set in .env');
  await q(`UPDATE direct_book_pushes SET status='running', updated_at=now() WHERE reservation_id=$1`, [reservationId]);

  const [first, ...rest] = String(r.full_name).trim().split(/\s+/);
  const last = rest.join(' ') || first;
  const addr = r.address ?? {};
  const qty = r.kind === 'dorm' ? Number(r.guests_count) : 1;
  try {
    // 1. The room on the availability page, the right number of beds / rooms, then "Book".
    await page.goto(directBookUrl(String(r.check_in).slice(0, 10), String(r.check_out).slice(0, 10), Number(r.guests_count) || 1), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => /Cost for|are unavailable|Booking summary/.test(document.body?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    const reject = page.getByRole('button', { name: /reject all/i }).first();
    if (await reject.count()) await reject.click().catch(() => {});
    const cardEl = page.locator('section, article, li, div').filter({ has: page.getByRole('heading', { name: new RegExp('^' + name.replace(/[-]/g, '.') + '$', 'i') }) }).filter({ has: page.getByRole('combobox') }).last();
    if (!(await cardEl.count())) { steps.push({ step: 'room', ok: false, note: `"${name}" not found or not bookable for these dates`, shot: await shot('room') }); return finish('failed', `"${name}" is not bookable on direct-book for ${String(r.check_in).slice(0, 10)} → ${String(r.check_out).slice(0, 10)}`); }
    const sel = cardEl.getByRole('combobox').first();
    await sel.click();
    await page.waitForTimeout(400);
    const opts = page.getByRole('option');
    const n = await opts.count();
    let picked = false;
    for (let i = 0; i < n; i++) {
      const t = (await opts.nth(i).innerText()).trim();
      if (new RegExp(`^${qty}\\b`).test(t)) { await opts.nth(i).click(); picked = true; break; }
    }
    if (!picked) { steps.push({ step: 'quantity', ok: false, note: `no option for ${qty}`, shot: await shot('quantity') }); return finish('failed', `direct-book offers no "${qty}" for ${name}`); }
    await page.waitForTimeout(1200);
    steps.push({ step: 'room', ok: true, note: `${name} × ${qty}`, shot: await shot('room') });
    await page.getByRole('button', { name: /^book$/i }).last().click();
    await page.waitForURL(/\/book\b/, { timeout: 30000 });
    await page.waitForTimeout(2500);

    // 2. Your details.
    const got = {
      first: await fill(page, /^first name/i, first), last: await fill(page, /^last name/i, last),
      email: await fill(page, /^e-?mail$/i, r.email), confirm: await fill(page, /confirm e-?mail/i, r.email),
      phone: await fill(page, /^phone/i, r.phone), address: await fill(page, /^address$/i, addr.line1 || 'Not given'),
      address2: await fill(page, /additional line/i, addr.line2), city: await fill(page, /^city/i, addr.city || 'Not given'),
      state: await fill(page, /^state/i, addr.state), postcode: await fill(page, /^post ?code/i, addr.postcode || '00000'),
      country: await choose(page, /country|select a country/i, addr.country ? COUNTRY(addr.country) : null),
      arrival: r.arrival_time ? await choose(page, /arrival time|select time/i, r.arrival_time) : true,
      requests: await fill(page, /personal requests/i, [r.guest_notes, `Villa Layla website booking ${r.reference}`].filter(Boolean).join(' · ')),
    };
    const missing = Object.entries(got).filter(([, v]) => !v).map(([k]) => k);
    steps.push({ step: 'details', ok: !missing.length, note: missing.length ? `could not fill: ${missing.join(', ')}` : 'all filled', shot: await shot('details') });
    await page.getByRole('button', { name: /^continue$/i }).first().click();
    await page.waitForTimeout(2500);
    const invalid = await page.locator('[aria-invalid="true"]').count();
    if (invalid) { steps.push({ step: 'details-check', ok: false, note: `${invalid} field(s) refused by the engine`, shot: await shot('refused') }); return finish('failed', `direct-book refused ${invalid} field(s) in "Your details" (see screenshots)`); }

    // 3. Extras: none.
    const skip = page.getByRole('button', { name: /^(skip|continue)$/i }).first();
    if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(2500); }
    steps.push({ step: 'extras', ok: true, shot: await shot('extras') });

    // 4. Review: the hotel's card (not charged) and the terms.
    const filled = cardSet() ? await fillCard(page) : [];
    for (const box of await page.getByRole('checkbox').all()) { try { if (!(await box.isChecked())) await box.check({ force: true }); } catch { /* optional */ } }
    const fields = await fieldsOf(page);
    steps.push({ step: 'review', ok: true, note: `card fields filled: ${filled.join(', ') || 'none'} · page fields: ${fields.join(' | ').slice(0, 900)}`, shot: await shot('review') });
    const confirmBtn = page.getByRole('button', { name: /(confirm|complete|book now|place booking|pay)/i }).last();
    if (!(await confirmBtn.count())) return finish('failed', 'no final button found on the review step (see screenshots)');
    if (mode === 'dry') return finish('dry_ok', `test run reached the last step (${filled.length ? 'card filled' : 'card not filled'}); nothing was booked`);

    // 5. Book.
    await confirmBtn.click();
    await page.waitForFunction(() => /confirm|thank you|reference|booking number/i.test(document.body?.innerText || ''), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const text: string = await page.evaluate(() => document.body.innerText);
    const ref = text.match(/(?:booking|confirmation|reservation)\s*(?:number|reference|no\.?|#|code)?\s*[:#]?\s*([A-Z0-9-]{5,})/i)?.[1] ?? null;
    steps.push({ step: 'done', ok: !!ref, note: ref ? `reference ${ref}` : 'no reference found on the page', shot: await shot('done') });
    if (!ref && !/thank you|confirmed/i.test(text)) return finish('failed', 'pressed the final button but no confirmation appeared (see screenshots)');
    // The beds are now closed in Little Hotelier: the dashboard alert for this booking is done.
    await q(`UPDATE reservations SET cm_done_at=COALESCE(cm_done_at, now()), cm_done_by=COALESCE(cm_done_by, 'direct-book') WHERE id=$1`, [reservationId]);
    return finish('booked', ref ? `booked on direct-book, reference ${ref}` : 'booked on direct-book (reference not read)', ref);
  } catch (e) {
    steps.push({ step: 'error', ok: false, note: (e as Error).message.slice(0, 300), shot: await shot('error') });
    return finish('failed', (e as Error).message.slice(0, 300));
  }
}

/** Works through the queue (max `max` per pass). Failed ones are retried up to 3 times, 20 minutes apart. */
export async function pushQueue(page: any, log: (m: string) => void, max = 3) {
  if (pushMode() === 'off') return 0;
  const rows = await q<{ reservation_id: string }>(`SELECT reservation_id FROM direct_book_pushes
    WHERE status='queued' OR (status='running' AND updated_at < now() - interval '15 minutes') OR (status='failed' AND attempts < 3 AND updated_at < now() - interval '20 minutes')
    ORDER BY created_at LIMIT $1`, [max]).catch(() => []);
  for (const x of rows) await pushOne(page, x.reservation_id, log);
  return rows.length;
}
