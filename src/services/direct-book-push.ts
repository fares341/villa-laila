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

/** Put a booking in the queue (made on the website, reception confirmed it, or its deposit was paid). Safe to call twice: a booking already copied is never copied again. */
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
    // 1. Check for vue-select component (.ibe-v-select)
    const selectContainer = page.locator('.ibe-v-select, .v-select')
      .filter({ has: page.locator('label, span, div').filter({ hasText: label }) })
      .first();

    if (await selectContainer.count() && await selectContainer.isVisible()) {
      const searchInput = selectContainer.locator('input.vs__search, input[role="combobox"], input').first();
      if (await searchInput.count()) {
        await searchInput.click({ force: true });
        await page.waitForTimeout(300);
        await searchInput.fill('');
        await searchInput.type(text, { delay: 30 });
        await page.waitForTimeout(400);

        const opt = page.locator('.vs__dropdown-option, [role="option"]')
          .filter({ hasText: new RegExp('^\\s*' + text.replace(/[.*+?^${}()|[\\]/g, '\\$&') + '\\s*$', 'i') })
          .first();

        if (await opt.count()) {
          await opt.scrollIntoViewIfNeeded().catch(() => {});
          await opt.click({ force: true });
          await page.waitForTimeout(300);
          return true;
        }

        const partialOpt = page.locator('.vs__dropdown-option, [role="option"]')
          .filter({ hasText: new RegExp(text.replace(/[.*+?^${}()|[\\]/g, '\\$&'), 'i') })
          .first();
        if (await partialOpt.count()) {
          await partialOpt.scrollIntoViewIfNeeded().catch(() => {});
          await partialOpt.click({ force: true });
          await page.waitForTimeout(300);
          return true;
        }

        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        return true;
      }
    }

    // 2. Generic fallback
    let el = page.getByLabel(label).first();
    if (!(await el.count())) el = page.getByPlaceholder(label).first();
    if (!(await el.count())) el = page.locator('label, span, div').filter({ hasText: label }).first().locator('xpath=following::*[contains(@class, "select") or self::input or @role="combobox"][1]');
    if (!(await el.count())) return false;
    await el.click();
    await page.waitForTimeout(400);

    const opt = page.locator('li, [role="option"]').filter({ hasText: new RegExp('^\\s*' + text.replace(/[.*+?^${}()|[\\]/g, '\\$&') + '\\s*$', 'i') }).first();
    if (await opt.count()) {
      await opt.scrollIntoViewIfNeeded().catch(() => {});
      await opt.click({ force: true });
      return true;
    }
    await page.keyboard.type(text, { delay: 30 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    return true;
  } catch { return false; }
}

/** Card fields may sit inside a payment iframe: look in every frame. */
async function fillCard(page: any) {
  const c = card();
  const frames = [page.mainFrame(), ...page.frames()];
  const [expMonth, expYear] = (c.expiry || '').split(/[\/\s-]+/);
  // Auto-masking inputs add the slash automatically, so send digits only (e.g. 0429)
  const cleanExpiry = (c.expiry || '').replace(/\D/g, '');

  const want: [RegExp, string, string][] = [
    [/card ?number|cc-number|cardnumber|número/i, c.number, 'number'],
    [/name on card|card ?holder|cc-name|holder/i, c.name, 'name'],
    [/expir|exp-date|mm ?\/ ?yy|cc-exp/i, cleanExpiry, 'expiry'],
    [/exp.*month|cc-month|\bmm\b/i, expMonth, 'month'],
    [/exp.*year|cc-year|\b(yy|yyyy)\b/i, expYear, 'year'],
    [/cvc|cvv|security code|cc-csc/i, c.cvc, 'cvc'],
  ];
  const done: string[] = [];
  for (const [re, val, key] of want) {
    if (!val) continue;
    if (key === 'month' && done.includes('expiry')) continue;
    if (key === 'year' && done.includes('expiry')) continue;
    for (const f of frames) {
      try {
        const inputs = await f.$$('input, select');
        for (const i of inputs) {
          const attrs = await i.evaluate((n: any) => [n.name, n.id, n.placeholder, n.autocomplete, n.getAttribute('aria-label'), n.getAttribute('data-elements-stable-field-name')].filter(Boolean).join(' '));
          if (re.test(attrs) && await i.isVisible()) {
            const tagName = await i.evaluate((n: any) => n.tagName.toLowerCase());
            if (tagName === 'select') {
              await i.selectOption({ label: val }).catch(() => i.selectOption({ value: val })).catch(() => {});
            } else {
              await i.click().catch(() => {});
              await i.fill('').catch(() => {});
              await i.type(val, { delay: 40 });
            }
            done.push(key);
            break;
          }
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
    // Match heading for the room
    const h = page.getByRole('heading', { name: new RegExp(name.replace(/[-]/g, '.'), 'i') }).first();
    if (!(await h.count()) || !(await h.isVisible())) {
      steps.push({ step: 'room', ok: false, note: `"${name}" heading not found or not visible for these dates`, shot: await shot('room') });
      return finish('failed', `"${name}" is not bookable on direct-book for ${String(r.check_in).slice(0, 10)} → ${String(r.check_out).slice(0, 10)}`);
    }

    const sel = h.locator('xpath=following::*[contains(@role, "combobox")][1]');
    const selectBtn = h.locator('xpath=following::button[contains(., "Select")][1]');

    if (await sel.count() && await sel.isVisible()) {
      await sel.click();
      await page.waitForTimeout(400);
      const opts = page.getByRole('option');
      const n = await opts.count();
      let picked = false;
      for (let i = 0; i < n; i++) {
        const t = (await opts.nth(i).innerText()).trim();
        if (new RegExp(`^${qty}\\b`).test(t)) { await opts.nth(i).click(); picked = true; break; }
      }
      if (!picked) {
        steps.push({ step: 'quantity', ok: false, note: `no option for ${qty}`, shot: await shot('quantity') });
        return finish('failed', `direct-book offers no "${qty}" for ${name}`);
      }
    } else if (await selectBtn.count() && await selectBtn.isVisible()) {
      await selectBtn.click();
      await page.waitForTimeout(800);
    } else {
      steps.push({ step: 'room', ok: false, note: `neither combobox nor select button found for ${name}`, shot: await shot('room') });
      return finish('failed', `direct-book offers neither combobox nor select button for ${name}`);
    }
    await page.waitForTimeout(1200);
    steps.push({ step: 'room', ok: true, note: `${name} × ${qty}`, shot: await shot('room') });
    await page.getByRole('button', { name: /^book$/i }).last().click();
    await page.waitForURL(/\/book\b/, { timeout: 30000 });
    await page.waitForTimeout(2500);

    // 2. Your details.
    const guestCountry = addr.country ? COUNTRY(addr.country) : null;
    const got = {
      first: await fill(page, /^first name/i, first),
      last: await fill(page, /^last name/i, last),
      email: await fill(page, /^e-?mail$/i, r.email),
      confirm: await fill(page, /confirm e-?mail/i, r.email),
      phone: await fill(page, /^phone/i, r.phone || '+201000000000'),
      address: await fill(page, /^address$/i, addr.line1 || 'Main Street'),
      address2: await fill(page, /additional line/i, addr.line2),
      city: await fill(page, /^city/i, addr.city || 'Cairo'),
      state: await fill(page, /^state/i, addr.state),
      postcode: await fill(page, /^post ?code/i, addr.postcode || '11511'),
      country: await choose(page, /country/i, guestCountry || 'Egypt'),
      arrival: r.arrival_time ? await choose(page, /arrival/i, r.arrival_time) : true,
      requests: await fill(page, /personal requests/i, [r.guest_notes, r.arrival_time ? `Expected arrival: ${r.arrival_time}` : null, `Villa Layla website booking ${r.reference}`].filter(Boolean).join(' · ')),
    };
    // arrival, address2, state are optional and must never block booking
    const missing = Object.entries(got).filter(([k, v]) => !v && k !== 'arrival' && k !== 'address2' && k !== 'state').map(([k]) => k);
    steps.push({ step: 'details', ok: !missing.length, note: missing.length ? `could not fill: ${missing.join(', ')}` : 'all filled', shot: await shot('details') });
    await page.getByRole('button', { name: /^continue$/i }).first().click();
    await page.waitForTimeout(2500);
    const invalid = await page.locator('[aria-invalid="true"]').count();
    if (invalid) { steps.push({ step: 'details-check', ok: false, note: `${invalid} field(s) refused by the engine`, shot: await shot('refused') }); return finish('failed', `direct-book refused ${invalid} field(s) in "Your details" (see screenshots)`); }

    // 3. Extras: none.
    const skipRes = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      for (const b of buttons) {
        const aria = (b.getAttribute('aria-label') || '').trim();
        const txt = (b.innerText || '').trim();
        if (/skip extras/i.test(aria) || /skip extras/i.test(txt) || /^skip$/i.test(txt)) {
          b.click();
          return { method: 'click', aria, txt, id: b.id };
        }
      }
      return { method: 'none' };
    });
    log(`[skip action]: ${JSON.stringify(skipRes)}`);
    await page.waitForTimeout(2500);
    steps.push({ step: 'extras', ok: true, shot: await shot('extras') });

    // 4. Review: check terms checkbox first, then click "Proceed to payment"
    for (const box of await page.getByRole('checkbox').all()) { try { if (!(await box.isChecked())) await box.check({ force: true }); } catch { /* optional */ } }
    await page.evaluate(() => {
      const cbs = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')) as HTMLElement[];
      for (const cb of cbs) {
        if (cb instanceof HTMLInputElement && !cb.checked) {
          cb.click();
        } else if (cb.getAttribute('aria-checked') !== 'true') {
          cb.click();
        }
      }
    });
    await page.waitForTimeout(1000);

    // In direct-book, clicking "Proceed to payment" (enabled after terms checkbox) opens the card form
    const proceedBtn = page.getByRole('button', { name: /proceed to payment|continue to payment/i }).first();
    if (await proceedBtn.count()) {
      log('Clicking Proceed to payment button...');
      await proceedBtn.scrollIntoViewIfNeeded().catch(() => {});
      await proceedBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(5000);
    } else {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        for (const b of btns) {
          if (/proceed to payment/i.test(b.innerText || '')) {
            b.click();
            return;
          }
        }
      });
      await page.waitForTimeout(5000);
    }

    // Now payment modal / fields / iframes are loaded: fill hotel card
    const filled = cardSet() ? await fillCard(page) : [];
    log(`Card fields filled: ${filled.join(', ') || 'none'}`);

    // If there are any additional checkboxes on the payment form
    for (const box of await page.getByRole('checkbox').all()) { try { if (!(await box.isChecked())) await box.check({ force: true }); } catch { /* optional */ } }

    const fields = await fieldsOf(page);
    steps.push({ step: 'review', ok: true, note: `card fields filled: ${filled.join(', ') || 'none'} · page fields: ${fields.join(' | ').slice(0, 900)}`, shot: await shot('review') });
    
    // Find final visible booking button
    let confirmBtn = page.getByRole('button', { name: /^book$/i }).filter({ hasNotText: /Amira|Spacious|Bed|USD|Select|Proceed to payment/i }).first();
    if (!(await confirmBtn.count()) || !(await confirmBtn.isVisible())) {
      confirmBtn = page.locator('button').filter({ hasText: /^book$/i }).filter({ hasNotText: /Amira|Spacious|Bed|USD|Select|Proceed to payment/i }).first();
    }
    if (!(await confirmBtn.count())) {
      confirmBtn = page.locator('button').filter({ hasText: /(confirm|complete|book now|place booking|pay|book)/i }).filter({ hasNotText: /Amira|Spacious|Bed|USD|Select|Proceed to payment/i }).last();
    }
    if (!(await confirmBtn.count())) return finish('failed', 'no final button found on the review step (see screenshots)');
    if (mode === 'dry') return finish('dry_ok', `test run reached the last step (${filled.length ? 'card filled' : 'card not filled'}); nothing was booked`);

    // 5. Book: click the visible Book button
    log('Clicking final Book button...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      for (const b of btns) {
        const txt = (b.innerText || '').trim();
        if (/^book$/i.test(txt) && b.offsetParent !== null) {
          b.scrollIntoView();
          b.click();
          return;
        }
      }
    });
    // Also trigger via Playwright locator if still on page
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click({ force: true }).catch(() => {});
    }
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
