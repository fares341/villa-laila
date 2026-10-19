// Spreadsheet (CSV/XLSX) import: map → normalise → validate → preview → commit. Original file is stored as a backup.
import * as XLSX from 'xlsx';
import { randomInt } from 'node:crypto';
import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { isIsoDate, todayLocal, rangeStr } from '@/lib/dates';
import { normalizePhone, upsertGuest } from './guests';
import { freeUnits, pickUnits } from './availability';
import { quote } from './pricing';
import { audit } from './audit';

export const FIELDS = ['guestName', 'phone', 'email', 'nationality', 'checkIn', 'checkOut', 'guests', 'room', 'status', 'total', 'paid', 'notes'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, number | null>>;
export const FIELD_LABEL: Record<Field, string> = { guestName: 'Guest name *', phone: 'Phone', email: 'Email', nationality: 'Nationality', checkIn: 'Check-in date *', checkOut: 'Check-out date *', guests: 'Number of guests', room: 'Room / bed', status: 'Status', total: 'Total amount', paid: 'Amount paid', notes: 'Notes' };

const GUESS: Record<Field, RegExp> = {
  guestName: /(guest|name|اسم|nombre|nom|client)/i, phone: /(phone|mobile|tel|whats|هاتف|موبايل|رقم|tél)/i, email: /(e-?mail|mail|بريد)/i,
  nationality: /(national|country|جنس|nacional|pays)/i, checkIn: /(check.?in|arriv|from|start|وصول|دخول|llegada|entrada)/i, checkOut: /(check.?out|depart|leave|to$|end|مغادرة|خروج|salida)/i,
  guests: /(guests?|pax|persons?|people|عدد|personas)/i, room: /(room|bed|dorm|غرفة|سرير|habitaci|lit)/i, status: /(status|state|حالة|estado)/i,
  total: /(total|price|amount|سعر|إجمالي|precio)/i, paid: /(paid|deposit|payment|مدفوع|عربون|pagado)/i, notes: /(note|comment|remark|ملاحظ|nota)/i,
};

export function parseFile(buf: Buffer): { headers: string[]; rows: string[][]; truncated: boolean } {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('The file has no sheets');
  const all = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: '', blankrows: false });
  if (!all.length) throw new Error('The file is empty');
  const cell = (v: any) => (v instanceof Date ? 'D:' + new Date(+v + 12 * 3600e3).toISOString().slice(0, 10) : String(v ?? '').trim());
  const headers = all[0].map((h: any) => String(h ?? '').trim());
  const rows = all.slice(1, 5001).map((r) => headers.map((_, i) => cell(r[i])));
  return { headers, rows, truncated: all.length > 5001 };
}

export function guessMapping(headers: string[]): Mapping {
  const m: Mapping = {}; const used = new Set<number>();
  for (const f of FIELDS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && GUESS[f].test(h));
    if (i >= 0) { m[f] = i; used.add(i); }
  }
  return m;
}

export function normDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (s.startsWith('D:')) return s.slice(2);
  if (isIsoDate(s)) return s;
  let m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(s);
  if (m) { const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; return isIsoDate(iso) ? iso : null; }
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s); // DAY-FIRST (Egypt/Europe)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isIsoDate(iso) ? iso : null; }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); return d.toISOString().slice(0, 10); } // Excel serial
  return null;
}

const STATUS_WORDS: [RegExp, string][] = [
  [/^(confirm|مؤكد|confirmad|confirmé)/i, 'confirmed'], [/^(pend|request|انتظار|قيد|pendiente|attente)/i, 'pending'], [/^(cancel|ملغ|cancelad|annul)/i, 'cancelled'],
  [/^(check.?in|in.?house|وصل|حاضر)/i, 'checked_in'], [/^(check.?out|left|departed|غادر|مغادر|salió)/i, 'checked_out'], [/^(no.?show|لم يحضر)/i, 'no_show'],
];
export function normStatus(v: string): string | null { const s = v.trim(); if (!s) return 'confirmed'; return STATUS_WORDS.find(([r]) => r.test(s))?.[1] ?? null; }
const num = (v: string): number | null => { if (!v) return null; const n = Number(v.replace(/[, ]/g, '').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; };

export type Parsed = { rowNo: number; name: string; phone: string | null; email: string | null; nationality: string | null; checkIn: string; checkOut: string; guests: number; room: string; status: string; totalCents: number | null; paidCents: number; notes: string | null; unitId: string | null; roomTypeId: string | null };
export type RowResult = { rowNo: number; data: Partial<Parsed>; errors: string[]; warnings: string[]; ok: boolean };

export async function validateRows(rows: string[][], mapping: Mapping, opts: { defaultRoomTypeId?: string | null } = {}): Promise<{ results: RowResult[]; summary: { total: number; ok: number; rejected: number; warnings: number } }> {
  const units = await q<any>(`SELECT u.id, u.label, u.capacity, rm.name room, rm.room_type_id FROM units u JOIN rooms rm ON rm.id=u.room_id`);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const unitIndex = new Map<string, any[]>();
  for (const u of units) for (const k of [norm(`${u.room} ${u.label}`), norm(u.label), norm(u.room)]) unitIndex.set(k, [...(unitIndex.get(k) ?? []), u]);
  const get = (r: string[], f: Field) => (mapping[f] != null && mapping[f]! >= 0 ? r[mapping[f]!] ?? '' : '');
  const today = todayLocal();
  const results: RowResult[] = [];
  const seenKey = new Map<string, number>();
  const occupied: { unit: string; from: string; to: string; row: number }[] = [];
  const existing = await q<any>(`SELECT ru.unit_id, lower(ru.during) s, upper(ru.during) e FROM reservation_units ru WHERE ru.active`);
  const dupExisting = new Set((await q<any>(`SELECT lower(g.full_name) n, r.check_in, r.check_out FROM reservations r JOIN guests g ON g.id=r.guest_id`)).map((x) => `${x.n}|${x.check_in}|${x.check_out}`));

  rows.forEach((r, i) => {
    const rowNo = i + 2; const errors: string[] = []; const warnings: string[] = [];
    const name = get(r, 'guestName').trim();
    const ci = normDate(get(r, 'checkIn')), co = normDate(get(r, 'checkOut'));
    const status = normStatus(get(r, 'status'));
    const phoneRaw = get(r, 'phone'); const phone = normalizePhone(phoneRaw);
    const email = get(r, 'email').trim().toLowerCase() || null;
    const guests = Math.max(1, Math.round(num(get(r, 'guests')) ?? 1));
    const room = get(r, 'room').trim();
    if (!name) errors.push('Missing guest name');
    if (!ci) errors.push(`Check-in date missing or not understood ("${get(r, 'checkIn')}")`);
    if (!co) errors.push(`Check-out date missing or not understood ("${get(r, 'checkOut')}")`);
    if (ci && co && co <= ci) errors.push('Check-out must be after check-in');
    if (ci && co && (Date.parse(co) - Date.parse(ci)) / 86400000 > 365) errors.push('Stay longer than a year — probably a typo');
    if (!status) errors.push(`Unknown status "${get(r, 'status')}"`);
    if (phoneRaw && !phone) warnings.push(`Phone "${phoneRaw}" looks invalid and will be ignored`);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) warnings.push('Email looks invalid');
    if (!phone && !email) warnings.push('No phone or email');
    const total = num(get(r, 'total')); const paid = num(get(r, 'paid')) ?? 0;
    if (total != null && paid > total) warnings.push('Paid amount is greater than total');

    let unit: any = null;
    if (room) {
      const hits = unitIndex.get(norm(room)) ?? [];
      if (hits.length === 1) unit = hits[0];
      else if (hits.length > 1) warnings.push(`Room/bed "${room}" matches several beds — assign manually`);
      else warnings.push(`Room/bed "${room}" not found in inventory`);
    }
    const active = ['confirmed', 'pending', 'checked_in', 'checked_out'].includes(status ?? '');
    const future = co ? co >= today : false;
    if (active && future && !unit && !opts.defaultRoomTypeId) errors.push('Current/future stay needs a known bed (fix the Room column or choose a default room type)');
    if (ci && co && name) {
      const key = `${name.toLowerCase()}|${ci}|${co}`;
      if (seenKey.has(key)) errors.push(`Duplicate of row ${seenKey.get(key)}`); else seenKey.set(key, rowNo);
      if (dupExisting.has(key)) errors.push('Already exists in the system (same name and dates)');
    }
    if (unit && active && ci && co && !errors.length) {
      const clash = occupied.find((o) => o.unit === unit.id && o.from < co && ci < o.to);
      if (clash) errors.push(`Overlaps row ${clash.row} on the same bed`);
      const ex = existing.find((o: any) => o.unit_id === unit.id && o.s < co && ci < o.e);
      if (ex) errors.push('Overlaps an existing reservation on the same bed');
      if (!clash && !ex) occupied.push({ unit: unit.id, from: ci, to: co, row: rowNo });
    }
    results.push({ rowNo, ok: errors.length === 0, errors, warnings, data: { rowNo, name, phone, email, nationality: get(r, 'nationality').trim() || null, checkIn: ci ?? '', checkOut: co ?? '', guests, room, status: status ?? '', totalCents: total != null ? Math.round(total * 100) : null, paidCents: Math.round(paid * 100), notes: get(r, 'notes').trim() || null, unitId: unit?.id ?? null, roomTypeId: unit?.room_type_id ?? opts.defaultRoomTypeId ?? null } });
  });
  return { results, summary: { total: results.length, ok: results.filter((x) => x.ok).length, rejected: results.filter((x) => !x.ok).length, warnings: results.filter((x) => x.warnings.length).length } };
}

const REF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mkRef = () => 'VL-' + Array.from({ length: 6 }, () => REF[randomInt(REF.length)]).join('');

export async function commitImport(batchId: string, rows: string[][], mapping: Mapping, opts: { defaultRoomTypeId?: string | null; paidVerified: boolean }, staffUserId: string, actor: string) {
  const { results } = await validateRows(rows, mapping, opts);
  const rejected: { row: number; reason: string }[] = results.filter((r) => !r.ok).map((r) => ({ row: r.rowNo, reason: r.errors.join('; ') }));
  let imported = 0;
  await tx(async (c) => {
    const cq = c as unknown as Q;
    for (const r of results.filter((x) => x.ok)) {
      const d = r.data as Parsed;
      await c.query('SAVEPOINT row');
      try {
        const active = ['confirmed', 'pending', 'checked_in', 'checked_out'].includes(d.status);
        let alloc: { unit: string; guests: number }[] = [];
        let typeId = d.roomTypeId;
        if (active && d.unitId) { alloc = [{ unit: d.unitId, guests: d.guests }]; }
        else if (active && typeId && d.checkOut >= todayLocal()) {
          const t = (await c.query('SELECT kind FROM room_types WHERE id=$1', [typeId])).rows[0];
          const picked = pickUnits(t.kind, await freeUnits(cq, typeId, d.checkIn, d.checkOut), d.guests);
          if (!picked) throw new Error('No free bed for the default room type');
          alloc = picked.map((p) => ({ unit: p.unit.id, guests: p.guests }));
        }
        if (!typeId) typeId = (await c.query('SELECT id FROM room_types ORDER BY sort_order LIMIT 1')).rows[0]?.id;
        if (!typeId) throw new Error('No room types exist — create rooms first');
        let total = d.totalCents;
        if (total == null) { try { total = (await quote(cq, typeId, d.checkIn, d.checkOut, Math.max(1, alloc.length))).totalCents; } catch { total = 0; } }
        const guestId = await upsertGuest(cq, { fullName: d.name, email: d.email, phone: d.phone, nationality: d.nationality, language: 'en' });
        let ref = mkRef();
        const ins = await c.query(
          `INSERT INTO reservations(reference,guest_id,room_type_id,check_in,check_out,guests_count,source,status,total_cents,staff_notes,created_by)
           VALUES($1,$2,$3,$4,$5,$6,'import',$7,$8,$9,$10) RETURNING id`, [ref, guestId, typeId, d.checkIn, d.checkOut, d.guests, d.status, total, `[Imported row ${d.rowNo}] ${d.notes ?? ''}`.trim(), staffUserId]);
        const rid = ins.rows[0].id;
        for (const a of alloc) await c.query('INSERT INTO reservation_units(reservation_id,unit_id,during,guests,active) VALUES($1,$2,$3::daterange,$4,$5)', [rid, a.unit, rangeStr(d.checkIn, d.checkOut), a.guests, !['checked_out'].includes(d.status) || d.checkOut >= todayLocal()]);
        if (d.paidCents > 0) await c.query(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,recorded_by,verified_by,verified_at) VALUES($1,$2,'other','Imported from spreadsheet',$3,'Imported',$4,$5,$6)`,
          [rid, d.paidCents, opts.paidVerified ? 'verified' : 'recorded', staffUserId, opts.paidVerified ? staffUserId : null, opts.paidVerified ? new Date() : null]);
        await c.query(`INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,'imported',$3)`, [rid, actor, JSON.stringify({ batchId, row: d.rowNo })]);
        await c.query('RELEASE SAVEPOINT row'); imported++;
      } catch (e: any) {
        await c.query('ROLLBACK TO SAVEPOINT row');
        rejected.push({ row: r.rowNo, reason: e.code === '23P01' ? 'Overlaps another reservation on the same bed' : e.message });
      }
    }
    await c.query(`UPDATE import_batches SET status='imported', imported_rows=$2, rejected_rows=$3, report=jsonb_set(report,'{rejected}',$4::jsonb), mapping=$5 WHERE id=$1`, [batchId, imported, rejected.length, JSON.stringify(rejected), JSON.stringify(mapping)]);
    await audit(actor, 'import.commit', 'import_batch', batchId, { imported, rejected: rejected.length }, cq);
  });
  return { imported, rejected };
}
