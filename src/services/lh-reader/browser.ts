import path from 'node:path';
import fs from 'node:fs';
import { UPLOAD_DIR } from '@/lib/uploads';
import { getSetting, setSetting } from '../settings';

/**
 * A real Chrome (headless) signed in to Little Hotelier with the read-only account. The browser profile is kept on
 * disk, so it signs in once and stays signed in; it only signs in again when Little Hotelier logs it out.
 * It never clicks anything except the sign-in form.
 *
 *   LH_EMAIL, LH_PASSWORD        the read-only Little Hotelier user (server .env)
 *   LH_LOGIN_URL                 default https://app.littlehotelier.com/
 *   LH_BOOKINGS_URL              the page that lists reservations (found by discovery)
 *   CHROMIUM_PATH                default /usr/bin/chromium-browser (installed in the Docker image)
 */
export const lhEnv = {
  get email() { return process.env.LH_EMAIL || ''; },
  get password() { return process.env.LH_PASSWORD || ''; },
  get loginUrl() { return process.env.LH_LOGIN_URL || 'https://app.littlehotelier.com/'; },
  get bookingsUrl() { return process.env.LH_BOOKINGS_URL || ''; },
  get chromium() { return process.env.CHROMIUM_PATH || ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => fs.existsSync(p)) || '/usr/bin/chromium-browser'; },
};
export const PROFILE_DIR = path.join(UPLOAD_DIR, 'lh-profile');

export type Captured = { url: string; status: number; json: unknown };

export async function openBrowser() {
  const { chromium } = await import('playwright-core');
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: lhEnv.chromium, headless: true, viewport: { width: 1366, height: 900 }, locale: 'en-GB', timezoneId: 'Africa/Cairo',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

/** Collects every JSON response the page loads while `fn` runs. */
export async function capture(page: any, fn: () => Promise<unknown>, waitMs = 8000): Promise<Captured[]> {
  const got: Captured[] = [];
  const on = async (res: any) => {
    try {
      const type = res.headers()['content-type'] || '';
      if (!/json/.test(type)) return;
      const url = res.url();
      if (/analytics|segment|sentry|intercom|hotjar|google|facebook|launchdarkly|datadog|newrelic/i.test(url)) return;
      got.push({ url, status: res.status(), json: await res.json() });
    } catch { /* body not readable */ }
  };
  page.on('response', on);
  try { await fn(); await page.waitForLoadState('networkidle', { timeout: waitMs }).catch(() => {}); await page.waitForTimeout(1500); }
  finally { page.off('response', on); }
  return got;
}

const visible = async (page: any, sel: string) => { const el = page.locator(sel).first(); return (await el.count()) > 0 && (await el.isVisible().catch(() => false)) ? el : null; };

/** True if a sign-in form is on screen. */
export async function onLoginPage(page: any) {
  return !!(await visible(page, 'input[type="password"]')) || /login|sign[-_]?in|auth/i.test(page.url());
}

/**
 * Signs in if needed. Handles a one-page form and the two-step (email, then password) form.
 * If Little Hotelier asks for a code, the owner sends it to the admin bot with /lhcode 123456.
 */
export async function ensureSignedIn(page: any, log: (m: string) => void, notify: (m: string) => Promise<void>) {
  if (!(await onLoginPage(page))) return true;
  if (!lhEnv.email || !lhEnv.password) { log('LH_EMAIL / LH_PASSWORD not set'); return false; }
  log('signing in to Little Hotelier');
  const email = await visible(page, 'input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i]');
  if (email) { await email.fill(lhEnv.email); }
  let pass = await visible(page, 'input[type="password"]');
  if (!pass) { await page.keyboard.press('Enter'); await page.waitForTimeout(2500); pass = await visible(page, 'input[type="password"]'); }
  if (!pass) { await notify('Little Hotelier reader: the sign-in page looks different, it could not find the password field. Nothing was read.'); return false; }
  await pass.fill(lhEnv.password);
  await Promise.all([page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}), pass.press('Enter')]);
  await page.waitForTimeout(3000);
  const code = await visible(page, 'input[autocomplete="one-time-code"], input[name*="code" i], input[name*="otp" i], input[id*="code" i]');
  if (code) {
    await setSetting('lh_otp', null);
    await notify('Little Hotelier is asking for a sign-in code. Send it here as: /lhcode 123456 (you have 5 minutes).');
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(5000);
      const v = await getSetting<any>('lh_otp').catch(() => null);
      if (v?.code) { await code.fill(String(v.code)); await code.press('Enter'); await setSetting('lh_otp', null); await page.waitForTimeout(4000); break; }
    }
  }
  if (await onLoginPage(page)) { await notify('Little Hotelier reader: sign-in failed (check LH_EMAIL / LH_PASSWORD, or the code). It will try again in 10 minutes.'); return false; }
  log('signed in');
  return true;
}
