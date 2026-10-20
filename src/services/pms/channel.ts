import { q } from '@/lib/db';
import type { Q } from '@/lib/db';
import { todayLocal, addDays, isIsoDate } from '@/lib/dates';
import { audit } from '../audit';

/**
 * Little Hotelier channel manager adapter.
 *
 * Little Hotelier (SiteMinder) does not publish an open REST API; property systems connect through a partner
 * endpoint or middleware that SiteMinder issues per property. This adapter talks to that endpoint when
 *   LH_API_BASE, LH_API_KEY and LH_PROPERTY_ID
 * are set, and otherwise records every action in channel_sync_log as "queued" so nothing is lost and staff can
 * mirror it in the Little Hotelier extranet. Rates can also be loaded from a CSV export (Dashboard → Channel manager).
 *
 * Expected endpoint contract (adapt in one place below if your partner endpoint differs):
 *   GET  {base}/properties/{id}/rates?start=YYYY-MM-DD&end=YYYY-MM-DD
 *        → [{ "room_type": "<channel_code>", "date": "YYYY-MM-DD", "rate": 1200.00, "available": 3 }]
 *   POST {base}/properties/{id}/availability
 *        ← { "room_type": "<channel_code>", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "delta": -1, "stop_sell": false, "reason": "walk_in" }
 */
export const lhEnv = {
  get base() { return (process.env.LH_API_BASE || '').replace(/\/+$/, ''); },
  get key() { return process.env.LH_API_KEY || ''; },
  get property() { return process.env.LH_PROPERTY_ID || ''; },
};
export const channelEnabled = () => !!(lhEnv.base && lhEnv.key && lhEnv.property);

async function log(direction: 'in' | 'out', action: string, status: 'ok' | 'error' | 'skipped' | 'queued', payload: unknown, roomTypeId: string | null = null, error: string | null = null) {
  await q(`INSERT INTO channel_sync_log(direction,action,room_type_id,payload,status,error) VALUES($1,$2,$3,$4,$5,$6)`,
    [direction, action, roomTypeId, JSON.stringify(payload ?? {}), status, error]).catch((e) => console.error('[channel log]', e));
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${lhEnv.base}/properties/${encodeURIComponent(lhEnv.property)}${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${lhEnv.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

type RateRow = { roomTypeId: string; date: string; cents: number; available?: number | null };

/**
 * Store daily rates. Past dates are written only if we have nothing for them yet, so the price a night actually
 * had in Little Hotelier is never replaced by a later change.
 */
export async function storeRates(rows: RateRow[], source: 'little_hotelier' | 'csv_import' | 'manual', opts: { overwritePast?: boolean } = {}) {
  const today = todayLocal();
  let written = 0;
  for (const r of rows) {
    if (!isIsoDate(r.date) || !Number.isFinite(r.cents) || r.cents < 0) continue;
    const past = r.date < today;
    const sql = past && !opts.overwritePast
      ? `INSERT INTO channel_daily_rates(room_type_id,rate_date,rate_cents,source,available) VALUES($1,$2,$3,$4,$5) ON CONFLICT (room_type_id,rate_date) DO NOTHING`
      : `INSERT INTO channel_daily_rates(room_type_id,rate_date,rate_cents,source,available) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (room_type_id,rate_date) DO UPDATE SET rate_cents=EXCLUDED.rate_cents, source=EXCLUDED.source, available=EXCLUDED.available, fetched_at=now()`;
    const res = await q(sql + ' RETURNING 1', [r.roomTypeId, r.date, Math.round(r.cents), source, r.available ?? null]);
    written += res.length;
  }
  return written;
}

/** Pull live rates for today … +days from Little Hotelier. */
export async function pullRates(days = 120): Promise<{ ok: boolean; written: number; message: string }> {
  const start = todayLocal(), end = addDays(start, days);
  if (!channelEnabled()) {
    await log('in', 'rates.pull', 'skipped', { start, end, reason: 'LH_API_* not configured' });
    return { ok: false, written: 0, message: 'Little Hotelier connection is not configured.' };
  }
  try {
    const data = await call('GET', `/rates?start=${start}&end=${end}`);
    const types = await q<{ id: string; channel_code: string | null; code: string }>('SELECT id, channel_code, code FROM room_types');
    const byCode = new Map<string, string>();
    for (const t of types) { if (t.channel_code) byCode.set(t.channel_code, t.id); byCode.set(t.code, t.id); }
    const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.rates) ? data.rates : [];
    const rows: RateRow[] = [];
    for (const x of list) {
      const id = byCode.get(String(x.room_type ?? x.room_type_code ?? x.roomType ?? ''));
      if (!id) continue;
      rows.push({ roomTypeId: id, date: String(x.date).slice(0, 10), cents: Math.round(Number(x.rate ?? x.price) * 100), available: x.available ?? null });
    }
    const written = await storeRates(rows, 'little_hotelier');
    await log('in', 'rates.pull', 'ok', { start, end, received: list.length, written });
    return { ok: true, written, message: `Synced ${written} daily rates.` };
  } catch (e) {
    await log('in', 'rates.pull', 'error', { start, end }, null, (e as Error).message);
    return { ok: false, written: 0, message: (e as Error).message };
  }
}

/** Tell Little Hotelier that units were taken/released locally (walk-in, room move, early check-out). */
export async function pushAvailability(c: Q | null, input: { roomTypeId: string; from: string; to: string; delta: number; reason: string; stopSell?: boolean }) {
  const t = (await (c ? c.query('SELECT channel_code, code FROM room_types WHERE id=$1', [input.roomTypeId]).then((r) => r.rows) : q('SELECT channel_code, code FROM room_types WHERE id=$1', [input.roomTypeId])))[0];
  const payload = { room_type: t?.channel_code || t?.code, from: input.from, to: input.to, delta: input.delta, stop_sell: !!input.stopSell, reason: input.reason };
  if (!channelEnabled()) { await log('out', 'availability.push', 'queued', payload, input.roomTypeId, 'Not connected — update Little Hotelier manually'); return { ok: false }; }
  try {
    await call('POST', '/availability', payload);
    await log('out', 'availability.push', 'ok', payload, input.roomTypeId);
    return { ok: true };
  } catch (e) {
    await log('out', 'availability.push', 'error', payload, input.roomTypeId, (e as Error).message);
    return { ok: false };
  }
}

/** CSV: date,room_code,rate[,available]  (room_code = room type code or its Little Hotelier code). */
export async function importRatesCsv(csv: string, actor: string, overwritePast = false) {
  const types = await q<{ id: string; channel_code: string | null; code: string }>('SELECT id, channel_code, code FROM room_types');
  const byCode = new Map<string, string>();
  for (const t of types) { if (t.channel_code) byCode.set(t.channel_code.toLowerCase(), t.id); byCode.set(t.code.toLowerCase(), t.id); }
  const rows: RateRow[] = [];
  const bad: string[] = [];
  csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const [date, code, rate, avail] = line.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
    if (i === 0 && !isIsoDate(date)) return; // header
    const id = byCode.get((code || '').toLowerCase());
    const cents = Math.round(Number(rate) * 100);
    if (!isIsoDate(date) || !id || !Number.isFinite(cents)) { bad.push(`line ${i + 1}`); return; }
    rows.push({ roomTypeId: id, date, cents, available: avail ? Number(avail) : null });
  });
  const written = await storeRates(rows, 'csv_import', { overwritePast });
  await log('in', 'rates.csv_import', 'ok', { rows: rows.length, written, bad: bad.slice(0, 20) });
  await audit(actor, 'channel.rates_import', 'channel', null, { rows: rows.length, written, bad: bad.length });
  return { rows: rows.length, written, bad };
}

export async function channelOverview() {
  const [last, counts, types] = await Promise.all([
    q<any>(`SELECT * FROM channel_sync_log ORDER BY created_at DESC LIMIT 40`),
    q<any>(`SELECT count(*)::int total, count(*) FILTER (WHERE rate_date >= current_date)::int future, max(fetched_at) last_fetch FROM channel_daily_rates`),
    q<any>(`SELECT id, code, channel_code, name FROM room_types WHERE active ORDER BY sort_order, code`),
  ]);
  const queued = (await q<any>(`SELECT count(*)::int n FROM channel_sync_log WHERE status IN ('queued','error') AND created_at > now() - interval '7 days'`))[0].n;
  return { connected: channelEnabled(), log: last, stats: counts[0], types, queued };
}
