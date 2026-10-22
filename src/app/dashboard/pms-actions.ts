'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { BookingError } from '@/services/errors';
import { checkInGuest, checkOutGuest, walkIn, moveRoom, setHousekeeping } from '@/services/pms/frontdesk';
import { applyRateOverride, voidFolioEntry, addFolioCharge } from '@/services/pms/folio';
import { takeFolioPayment, openShiftRow } from '@/services/pms/pos';
import { saveStaff, setRoster, copyWeek, waiveDeduction } from '@/services/pms/staff';
import { pullRates, importRatesCsv, storeRates } from '@/services/pms/channel';
import { saveEvent } from '@/services/events';
import { audit } from '@/services/audit';
import { setSetting } from '@/services/settings';
import { redistribute, reassignTask } from '@/services/pms/tasks';

const msg = (e: unknown) => (e instanceof BookingError ? (e.message && e.message !== e.code ? e.message : e.code.replace(/_/g, ' ').toLowerCase()) : (console.error('[pms action]', e), 'Something went wrong'));
const safe = (v: FormDataEntryValue | null, fallback: string) => { const s = String(v || ''); return s.startsWith('/') && !s.startsWith('//') ? s : fallback; };
const go = (back: string, k: 'ok' | 'err', text: string): never => redirect(`${back}${back.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(text)}`);
const cents = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); if (s === '') return null; const n = Math.round(Number(s.replace(/,/g, '')) * 100); return Number.isFinite(n) ? n : null; };
const str = (v: FormDataEntryValue | null) => String(v ?? '').trim();

/* ───────── Front desk ───────── */

export async function fdCheckIn(fd: FormData) {
  const u = await requireUser('frontdesk.use'); const back = safe(fd.get('back'), '/dashboard/frontdesk');
  try { await checkInGuest(str(fd.get('id')), u.email, u.id); } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath('/dashboard/frontdesk'); go(back, 'ok', 'Checked in');
}

export async function fdCheckOut(fd: FormData) {
  const u = await requireUser('frontdesk.use'); const back = safe(fd.get('back'), '/dashboard/frontdesk');
  const force = fd.get('force') === '1';
  if (force) await requireUser('reservation.cancel'); // owner / manager only
  try { await checkOutGuest(str(fd.get('id')), u.email, { force }); } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath('/dashboard/frontdesk'); go(back, 'ok', 'Checked out · room marked dirty');
}

export async function fdWalkIn(fd: FormData) {
  const u = await requireUser('frontdesk.use'); const back = '/dashboard/frontdesk';
  let id = '';
  try {
    const unitId = str(fd.get('unitId'));
    const ut = unitId ? (await q<any>(`SELECT rm.room_type_id FROM units u JOIN rooms rm ON rm.id=u.room_id WHERE u.id=$1`, [unitId]))[0] : null;
    if (!ut) throw new BookingError('INVALID_INPUT', 'Choose a free room or bed');
    const r = await walkIn({
      fullName: str(fd.get('fullName')), phone: str(fd.get('phone')) || null, email: str(fd.get('email')) || null, nationality: str(fd.get('nationality')) || null,
      roomTypeId: ut.room_type_id, unitIds: [unitId],
      nights: parseInt(str(fd.get('nights')), 10) || 1, guests: parseInt(str(fd.get('guests')), 10) || 1, actor: u.email, userId: u.id,
    });
    id = r.id;
  } catch (e) { go(back + '?walkin=1', 'err', msg(e)); }
  revalidatePath('/dashboard/frontdesk');
  go(`/dashboard/folio/${id}`, 'ok', 'Walk-in checked in · Little Hotelier notified');
}

export async function fdMoveRoom(fd: FormData) {
  const u = await requireUser('frontdesk.use'); const id = str(fd.get('id')); const back = safe(fd.get('back'), `/dashboard/folio/${id}`);
  try { await moveRoom({ reservationId: id, reservationUnitId: str(fd.get('ruId')) || undefined, newUnitId: str(fd.get('unitId')), effective: str(fd.get('effective')) || undefined, actor: u.email, userId: u.id }); }
  catch (e) { go(back, 'err', msg(e)); }
  revalidatePath(back); go(back, 'ok', 'Room moved · old room marked dirty');
}

export async function fdHousekeeping(fd: FormData) {
  const u = await requireUser('frontdesk.use'); const back = safe(fd.get('back'), '/dashboard/housekeeping');
  try { await setHousekeeping(str(fd.get('roomId')), str(fd.get('status')) as any, u.email); } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath(back); go(back, 'ok', 'Room status updated');
}

/* ───────── Folio ───────── */

export async function folioPayment(fd: FormData) {
  const u = await requireUser('payment.record'); const id = str(fd.get('id')); const back = `/dashboard/folio/${id}`;
  const method = str(fd.get('method')) === 'card' ? 'card' : 'cash';
  const shift = await openShiftRow();
  try { await takeFolioPayment({ reservationId: id, amountCents: cents(fd.get('amount')) ?? 0, method, shiftId: shift?.id ?? null, staffId: shift?.staff_id ?? null, userId: u.id, note: str(fd.get('note')) || null || undefined, actor: u.email }); }
  catch (e) { go(back, 'err', msg(e)); }
  revalidatePath(back); go(back, 'ok', 'Payment recorded');
}

export async function folioCharge(fd: FormData) {
  const u = await requireUser('reservation.edit'); const id = str(fd.get('id')); const back = `/dashboard/folio/${id}`;
  const unit = cents(fd.get('amount'));
  const desc = str(fd.get('description'));
  if (!unit || unit <= 0 || desc.length < 2) go(back, 'err', 'Enter a description and an amount');
  await addFolioCharge({ reservationId: id, kind: 'custom', description: desc, quantity: Math.max(1, Number(str(fd.get('qty'))) || 1), unitCents: unit!, userId: u.id });
  await audit(u.email, 'folio.charge', 'reservation', id, { desc, unit });
  revalidatePath(back); go(back, 'ok', 'Charge added');
}

export async function folioVoid(fd: FormData) {
  const u = await requireUser('rate.override'); const id = str(fd.get('id')); const back = `/dashboard/folio/${id}`;
  try { await voidFolioEntry(str(fd.get('entryId')), str(fd.get('reason')), u.email); } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath(back); go(back, 'ok', 'Line voided');
}

export async function folioRateOverride(fd: FormData) {
  const u = await requireUser('rate.override'); const id = str(fd.get('id')); const back = `/dashboard/folio/${id}`;
  try { await applyRateOverride(id, str(fd.get('from')), str(fd.get('to')), cents(fd.get('rate')) ?? -1, str(fd.get('reason')), u.id, u.email); }
  catch (e) { go(back, 'err', msg(e)); }
  revalidatePath(back); go(back, 'ok', 'Rate override applied');
}

/* ───────── Staff ───────── */

export async function staffSave(fd: FormData) {
  const u = await requireUser('staff.manage'); const back = '/dashboard/staff';
  try {
    await saveStaff({
      id: str(fd.get('id')) || undefined, fullName: str(fd.get('fullName')), role: str(fd.get('role')), phone: str(fd.get('phone')) || null,
      pin: str(fd.get('pin')) || null, isManager: fd.get('isManager') === 'on', canUsePos: fd.get('canUsePos') === 'on',
      monthlyTargetHours: Number(str(fd.get('target'))) || 208, hourlyRateCents: cents(fd.get('hourly')) ?? 0, dailyRateCents: cents(fd.get('daily')) ?? 0,
      active: fd.get('active') === 'on', userId: str(fd.get('userId')) || null,
    }, u.email);
  } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath(back); go(back, 'ok', 'Staff saved');
}

export async function rosterSet(fd: FormData) {
  const u = await requireUser('staff.manage'); const back = safe(fd.get('back'), '/dashboard/staff');
  try { await setRoster(str(fd.get('staffId')), str(fd.get('date')), str(fd.get('shift')), u.id, { start: str(fd.get('start')) || null, end: str(fd.get('end')) || null }); }
  catch (e) { go(back, 'err', msg(e)); }
  revalidatePath('/dashboard/staff'); redirect(back);
}

/** Save a whole week grid at once: fields named r|<staffId>|<date> = shift code. */
export async function rosterSaveWeek(fd: FormData) {
  const u = await requireUser('staff.manage'); const back = safe(fd.get('back'), '/dashboard/staff');
  try {
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith('r|')) continue;
      const [, staffId, date] = k.split('|');
      const prev = str(fd.get(`p|${staffId}|${date}`));
      if (String(v) === prev) continue;
      await setRoster(staffId, date, String(v), u.id);
    }
    if (fd.get('copy') === '1') await copyWeek(str(fd.get('monday')), 3, u.id);
  } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath('/dashboard/staff'); go(back, 'ok', fd.get('copy') === '1' ? 'Roster saved and copied to the next 3 weeks' : 'Roster saved');
}

export async function attendanceWaive(fd: FormData) {
  const u = await requireUser('staff.manage'); const back = safe(fd.get('back'), '/dashboard/staff/timesheet');
  try { await waiveDeduction(str(fd.get('id')), str(fd.get('reason')), u.id, u.email); } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath(back); go(back, 'ok', 'Deduction waived');
}

/* ───────── Catalog ───────── */

export async function productSave(fd: FormData) {
  const u = await requireUser('catalog.manage'); const back = '/dashboard/catalog';
  const id = str(fd.get('id'));
  const vals = [str(fd.get('name')), str(fd.get('posCategory')) || 'market', cents(fd.get('price')) ?? 0, cents(fd.get('cost')) ?? 0,
    fd.get('trackStock') === 'on', parseInt(str(fd.get('threshold')), 10) || 0, str(fd.get('barcode')) || null, fd.get('public') === 'on', str(fd.get('unitLabel')) || null, fd.get('active') === 'on'];
  if (!vals[0]) go(back, 'err', 'Name is required');
  const cat = vals[1] === 'meals' ? 'meal_breakfast' : vals[1] === 'services' ? 'other' : 'snack';
  try {
    if (id) {
      await q(`UPDATE products SET name=$2, pos_category=$3, price_cents=$4, cost_cents=$5, track_stock=$6, low_stock_threshold=$7, barcode=$8, public_visible=$9, unit_label=$10, is_active=$11 WHERE id=$1`, [id, ...vals]);
      const stock = str(fd.get('stock'));
      if (stock !== '') {
        const p = (await q<any>(`SELECT stock_quantity FROM products WHERE id=$1`, [id]))[0];
        const n = parseInt(stock, 10);
        if (Number.isFinite(n) && p && n !== p.stock_quantity) {
          await q(`UPDATE products SET stock_quantity=$2 WHERE id=$1`, [id, n]);
          await q(`INSERT INTO inventory_movements(product_id,movement_type,quantity,previous_stock,new_stock,note,created_by) VALUES($1,$2,$3,$4,$5,'Set from catalog',$6)`,
            [id, n > p.stock_quantity ? 'purchase' : 'adjustment_audit', n - p.stock_quantity, p.stock_quantity, n, u.id]);
        }
      }
    } else {
      await q(`INSERT INTO products(name,pos_category,price_cents,cost_cents,track_stock,low_stock_threshold,barcode,public_visible,unit_label,is_active,category,stock_quantity)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [...vals, cat, parseInt(str(fd.get('stock')), 10) || 0]);
    }
  } catch (e: any) { go(back, 'err', e?.code === '23505' ? 'That barcode is already used by another item' : msg(e)); }
  await audit(u.email, id ? 'product.update' : 'product.create', 'product', id || null, { name: vals[0] });
  revalidatePath(back); go(back, 'ok', 'Item saved');
}

export async function tourSave(fd: FormData) {
  const u = await requireUser('catalog.manage'); const back = '/dashboard/catalog?tab=tours';
  const id = str(fd.get('id'));
  const vals = [str(fd.get('name')), str(fd.get('organizer')) || 'Villa Layla Tours Desk', str(fd.get('duration')) || null, cents(fd.get('cost')) ?? 0, cents(fd.get('price')) ?? 0, fd.get('active') === 'on', str(fd.get('description')) || null];
  if (!vals[0]) go(back, 'err', 'Tour name is required');
  if (id) await q(`UPDATE tours_catalog SET name=$2, organizer=$3, duration=$4, cost_cents=$5, price_cents=$6, active=$7, description=$8 WHERE id=$1`, [id, ...vals]);
  else await q(`INSERT INTO tours_catalog(name,organizer,duration,cost_cents,price_cents,active,description) VALUES($1,$2,$3,$4,$5,$6,$7)`, vals);
  await audit(u.email, id ? 'tour.update' : 'tour.create', 'tour', id || null, { name: vals[0] });
  revalidatePath('/dashboard/catalog'); go(back, 'ok', 'Tour saved');
}

/* ───────── Events ───────── */

export async function eventSave(fd: FormData) {
  const u = await requireUser('events.manage');
  const id = str(fd.get('id'));
  const back = id ? `/dashboard/events/edit/${id}` : '/dashboard/events/edit/new';
  const img = fd.get('image');
  let image: { bytes: Buffer; mime: string } | null = null;
  if (img && typeof img !== 'string' && (img as File).size) {
    const f = img as File;
    if (f.size > 5 * 1024 * 1024) go(back, 'err', 'Image must be under 5 MB');
    if (!/^image\//.test(f.type)) go(back, 'err', 'Upload a JPG, PNG or WebP image');
    image = { bytes: Buffer.from(await f.arrayBuffer()), mime: f.type };
  }
  const cap = str(fd.get('capacity'));
  let savedId = '';
  try {
    savedId = await saveEvent({
      id: id || undefined, kind: str(fd.get('kind')) === 'day_use' ? 'day_use' : 'event',
      titleEn: str(fd.get('titleEn')), titleAr: str(fd.get('titleAr')), summaryEn: str(fd.get('summaryEn')), summaryAr: str(fd.get('summaryAr')),
      descriptionEn: str(fd.get('descriptionEn')), descriptionAr: str(fd.get('descriptionAr')), includesEn: str(fd.get('includes')),
      priceCents: cents(fd.get('price')) ?? 0, costCents: cents(fd.get('cost')) ?? 0, guestPriceCents: cents(fd.get('guestPrice')),
      capacity: cap === '' ? null : Math.max(1, parseInt(cap, 10) || 1),
      recurrence: (['daily', 'weekly', 'once'].includes(str(fd.get('recurrence'))) ? str(fd.get('recurrence')) : 'once') as any,
      weekdays: fd.getAll('weekdays').map((x) => parseInt(String(x), 10)).filter((n) => n >= 0 && n <= 6),
      onceDate: str(fd.get('onceDate')) || null, endsOn: str(fd.get('endsOn')) || null, startTime: str(fd.get('startTime')), endTime: str(fd.get('endTime')),
      payMethods: fd.getAll('payMethods').map(String) as any, active: fd.get('active') === 'on', image, imageUrl: str(fd.get('imageUrl')) || null,
    }, u.email);
  } catch (e) { go(back, 'err', msg(e)); }
  revalidatePath('/dashboard/events'); revalidatePath('/en'); revalidatePath('/ar');
  go(`/dashboard/events/edit/${savedId}`, 'ok', 'Saved and published on the website');
}

/* ───────── Channel manager ───────── */

export async function channelPull() {
  await requireUser('channel.manage');
  const r = await pullRates();
  revalidatePath('/dashboard/channel'); go('/dashboard/channel', r.ok ? 'ok' : 'err', r.message);
}

export async function channelImport(fd: FormData) {
  const u = await requireUser('channel.manage');
  const f = fd.get('file');
  let text = str(fd.get('csv'));
  if (f && typeof f !== 'string' && (f as File).size) text = await (f as File).text();
  if (!text) go('/dashboard/channel', 'err', 'Paste CSV rows or choose a file');
  const r = await importRatesCsv(text, u.email, fd.get('overwritePast') === 'on');
  revalidatePath('/dashboard/channel'); go('/dashboard/channel', 'ok', `${r.written} of ${r.rows} rates saved${r.bad.length ? ` · ${r.bad.length} lines skipped` : ''}`);
}

export async function channelMapping(fd: FormData) {
  const u = await requireUser('channel.manage');
  for (const [k, v] of fd.entries()) if (k.startsWith('code|')) await q(`UPDATE room_types SET channel_code=$2 WHERE id=$1`, [k.slice(5), String(v).trim() || null]);
  await audit(u.email, 'channel.mapping', 'channel', null, {});
  revalidatePath('/dashboard/channel'); go('/dashboard/channel', 'ok', 'Room type codes saved');
}

export async function channelManualRate(fd: FormData) {
  const u = await requireUser('channel.manage');
  const n = await storeRates([{ roomTypeId: str(fd.get('roomTypeId')), date: str(fd.get('date')), cents: cents(fd.get('rate')) ?? -1 }], 'manual', { overwritePast: false });
  await audit(u.email, 'channel.manual_rate', 'channel', null, { date: str(fd.get('date')) });
  revalidatePath('/dashboard/channel'); go('/dashboard/channel', n ? 'ok' : 'err', n ? 'Rate saved' : 'Not saved (past dates that already have a rate are kept as recorded)');
}

export async function latenessPolicySave(fd: FormData) {
  const u = await requireUser('staff.manage');
  const grace = Math.max(0, Math.min(60, parseInt(str(fd.get('grace')), 10) || 15));
  const mode = str(fd.get('mode')) === 'fraction' ? 'fraction' : 'fixed';
  const t1 = cents(fd.get('t1')) ?? 5000, t2 = cents(fd.get('t2')) ?? 10000;
  const policy = { grace_minutes: grace, mode, tiers: [
    { from: grace + 1, to: 30, fixed_cents: t1, day_fraction: 0.25 },
    { from: 31, to: 60, fixed_cents: t2, day_fraction: 0.5 },
    { from: 61, to: null, fixed_cents: null, day_fraction: 1, alert: true },
  ] };
  await setSetting('lateness_policy', policy);
  await audit(u.email, 'staff.lateness_policy', 'settings', null, policy);
  revalidatePath('/dashboard/staff/timesheet'); go('/dashboard/staff/timesheet', 'ok', 'Lateness policy saved');
}

/* ───────── Shift tasks ───────── */

export async function taskTemplateSave(fd: FormData) {
  const u = await requireUser('staff.manage'); const back = '/dashboard/tasks#templates';
  const id = str(fd.get('id'));
  const title = str(fd.get('title'));
  if (title.length < 2) go(back, 'err', 'Write the task name');
  const kind = ['check', 'money', 'unpaid', 'washes', 'tours', 'taxi'].includes(str(fd.get('kind'))) ? str(fd.get('kind')) : 'check';
  const items = str(fd.get('items')).split(/\n|,/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  const shifts = fd.getAll('shifts').map(String).filter(Boolean);
  const minutes = Math.min(480, Math.max(1, parseInt(str(fd.get('minutes')), 10) || 10));
  const vals = [title, kind, items, shifts.length ? shifts : ['MORNING', 'EVENING', 'NIGHT'], minutes, parseInt(str(fd.get('sort')), 10) || 0, fd.get('active') === 'on'];
  if (id) await q(`UPDATE shift_task_templates SET title=$2, kind=$3, items=$4, shift_codes=$5, minutes=$6, sort_order=$7, active=$8 WHERE id=$1`, [id, ...vals]);
  else await q(`INSERT INTO shift_task_templates(title,kind,items,shift_codes,minutes,sort_order,active) VALUES($1,$2,$3,$4,$5,$6,$7)`, vals);
  await audit(u.email, id ? 'task_template.update' : 'task_template.create', 'shift_task_template', id || null, { title });
  revalidatePath('/dashboard/tasks'); go('/dashboard/tasks', 'ok', 'Saved. Applies from the next shift.');
}

export async function taskRedistribute(fd: FormData) {
  const u = await requireUser('staff.manage');
  try { await redistribute(str(fd.get('runId')), u.email); } catch (e) { go('/dashboard/tasks', 'err', msg(e)); }
  revalidatePath('/dashboard/tasks'); go('/dashboard/tasks', 'ok', 'Open tasks shared again between everyone clocked in');
}

export async function taskReassign(fd: FormData) {
  const u = await requireUser('staff.manage');
  await reassignTask(str(fd.get('taskId')), str(fd.get('staffId')) || null, u.email);
  revalidatePath('/dashboard/tasks'); go('/dashboard/tasks', 'ok', 'Task moved');
}

export async function taskSettingsSave(fd: FormData) {
  const u = await requireUser('staff.manage');
  const m = Math.min(120, Math.max(0, parseInt(str(fd.get('after')), 10) || 0));
  await setSetting('shift_tasks', { distribute_after_minutes: m });
  await audit(u.email, 'task.settings', 'settings', null, { m });
  revalidatePath('/dashboard/tasks'); go('/dashboard/tasks', 'ok', 'Saved');
}
