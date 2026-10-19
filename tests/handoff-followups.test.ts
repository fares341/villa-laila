import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { q } from '@/lib/db';
import { addDays, todayLocal } from '@/lib/dates';
import { registerAdapter } from '@/services/channels';
import { getOrCreateConversation, botSend, takeOver, resumeBot, staffSend, resolve } from '@/services/conversations';
import { schedule, cancelFollowups, runDue, scanAndSchedule } from '@/services/followups';
import { createReservation, confirmReservation, cancelReservation } from '@/services/reservations';
import { handleTelegramUpdate } from '@/bot/flow';
import { hasDb, resetDb, seedInventory, guest, closePool, ruleDefaults } from './helpers';

const sent: { to: string; text: string }[] = [];
registerAdapter({ name: 'telegram', async send(to, text) { sent.push({ to, text }); return { messageId: String(sent.length) }; } });
const d = (n: number) => addDays(todayLocal(), n);
let staff: string; let inv: Awaited<ReturnType<typeof seedInventory>>;
let uid = 1000;
const upd = (chat: number, o: any) => ({ update_id: ++uid, ...o(chat) });
const msg = (text: string) => (chat: number) => ({ message: { message_id: uid, chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Ana' }, text } });
const cb = (data: string) => (chat: number) => ({ callback_query: { id: 'c' + uid, data, from: { id: chat, first_name: 'Ana' }, message: { chat: { id: chat } } } });

describe.skipIf(!hasDb)('human handoff', () => {
  beforeEach(async () => { await resetDb(); await ruleDefaults(); sent.length = 0; staff = (await q(`INSERT INTO users(email,name,password_hash,role) VALUES('r@x.test','Rita','x','receptionist') ON CONFLICT (email) DO UPDATE SET name='Rita' RETURNING id`))[0].id; });

  it('after takeover the bot stays silent (even to buttons) until an authorised resume; staff can then reply', async () => {
    const conv = await getOrCreateConversation('telegram', '555');
    await q(`UPDATE conversations SET language='en' WHERE id=$1`, [conv.id]);
    expect(await botSend(conv, 'hello')).toBe(true);
    await takeOver(conv.id, staff, 'Rita');
    expect(await botSend(conv, 'should not send')).toBe(false);
    sent.length = 0;
    await handleTelegramUpdate(upd(555, msg('hola?')));
    await handleTelegramUpdate(upd(555, cb('m:rooms')));
    expect(sent).toHaveLength(0);                                   // no automated reply while staff owns it
    expect((await q('SELECT count(*)::int n FROM messages WHERE conversation_id=$1 AND direction=\'in\'', [conv.id]))[0].n).toBe(2); // but messages are still recorded
    await staffSend(conv.id, staff, 'Rita', 'Hi, reception here');
    expect(sent.map((s) => s.text)).toEqual(['Hi, reception here']);
    await resumeBot(conv.id, 'Rita');
    expect(await botSend(conv, 'bot again')).toBe(true);
  });

  it('staff cannot reply without taking over; a second staff member cannot steal an assigned chat', async () => {
    const conv = await getOrCreateConversation('telegram', '556');
    await expect(staffSend(conv.id, staff, 'Rita', 'x')).rejects.toMatchObject({ code: 'BAD_STATE' });
    await takeOver(conv.id, staff, 'Rita');
    const other = (await q(`INSERT INTO users(email,name,password_hash,role) VALUES('m@x.test','Mo','x','manager') ON CONFLICT (email) DO UPDATE SET name='Mo' RETURNING id`))[0].id;
    await expect(takeOver(conv.id, other, 'Mo')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('takeover cancels pending bot follow-ups for that conversation', async () => {
    const conv = await getOrCreateConversation('telegram', '557');
    await schedule('incomplete_booking', new Date(Date.now() + 3600e3), `incomplete:${conv.id}:1`, { conversationId: conv.id });
    await takeOver(conv.id, staff, 'Rita');
    expect((await q(`SELECT status FROM scheduled_messages WHERE conversation_id=$1`, [conv.id]))[0].status).toBe('cancelled');
  });
});

describe.skipIf(!hasDb)('telegram booking journey (no AI key needed)', () => {
  beforeEach(async () => { await resetDb(); await ruleDefaults(); sent.length = 0; inv = await seedInventory(3); });

  it('language buttons first, guided booking creates a PENDING request (never "confirmed") and survives a restart mid-way', async () => {
    await handleTelegramUpdate(upd(900, msg('/start')));
    expect(sent.at(-1)!.text).toMatch(/language/i);
    await handleTelegramUpdate(upd(900, cb('lang:fr')));
    expect(sent.at(-1)!.text).toMatch(/Bienvenue/);
    await handleTelegramUpdate(upd(900, cb('m:new_booking')));
    await handleTelegramUpdate(upd(900, cb('d:' + d(10))));
    await handleTelegramUpdate(upd(900, cb('n:2')));
    // --- simulate process restart: nothing in memory, only the DB ---
    const saved = (await q(`SELECT flow, step, data FROM conversations WHERE external_id='900'`))[0];
    expect(saved).toMatchObject({ flow: 'booking', step: 'guests' });
    expect(saved.data).toMatchObject({ checkIn: d(10), checkOut: d(12) });
    await handleTelegramUpdate(upd(900, cb('g:2')));
    const options = sent.at(-1)!.text;
    expect(options).toMatch(/Dorm|dorm/i);
    await handleTelegramUpdate(upd(900, cb('r:' + inv.dorm)));
    await handleTelegramUpdate(upd(900, cb('u:name')));      // use Telegram first name "Ana"
    await handleTelegramUpdate(upd(900, msg('Skip')));       // phone step
    expect(sent.at(-1)!.text).toMatch(/Total/);
    await handleTelegramUpdate(upd(900, cb('a:submit')));
    const last = sent.at(-1)!.text;
    expect(last).toMatch(/PAS encore confirmée/);
    const r = (await q(`SELECT * FROM reservations`))[0];
    expect(r).toMatchObject({ status: 'pending', source: 'telegram', guests_count: 2, total_cents: 40000 });
    expect(last).toContain(r.reference);
    // duplicate delivery of the same Telegram update is ignored
    const before = sent.length;
    const dup = upd(900, cb('a:submit')); await handleTelegramUpdate(dup); await handleTelegramUpdate(dup);
    expect(sent.length).toBeLessThanOrEqual(before + 1);
    expect((await q('SELECT count(*)::int n FROM reservations'))[0].n).toBe(1);
  });

  it('"talk to reception" escalates, creates a dashboard task and the bot stops free-form handling', async () => {
    await handleTelegramUpdate(upd(901, cb('lang:en')));
    await handleTelegramUpdate(upd(901, cb('m:reception')));
    const c = (await q(`SELECT * FROM conversations WHERE external_id='901'`))[0];
    expect(c).toMatchObject({ status: 'needs_staff', escalation_reason: 'Guest asked for a person' });
    expect((await q(`SELECT count(*)::int n FROM tasks WHERE kind='escalation' AND status='open'`))[0].n).toBe(1);
  });

  it('only shows reservations linked to this chat', async () => {
    const r = await createReservation({ guest: guest('Web Guest', { telegramChatId: 111 }), roomTypeId: inv.dorm, checkIn: d(10), checkOut: d(12), guestsCount: 1, source: 'website', status: 'pending', actor: 't' });
    await handleTelegramUpdate(upd(902, cb('lang:en')));
    await handleTelegramUpdate(upd(902, cb('m:my_reservation')));
    await handleTelegramUpdate(upd(902, msg(r.reference)));
    expect(sent.at(-1)!.text).toMatch(/linked to this chat/);
  });
});

describe.skipIf(!hasDb)('follow-ups', () => {
  beforeEach(async () => { await resetDb(); await ruleDefaults(); sent.length = 0; inv = await seedInventory(3); });
  const run = () => runDue(async (conv, text) => botSend(conv, text), async () => {});

  async function pendingWithChat() {
    await handleTelegramUpdate(upd(700, cb('lang:en')));
    const r = await createReservation({ guest: guest('F Guest', { telegramChatId: 700 }), roomTypeId: inv.dorm, checkIn: d(10), checkOut: d(12), guestsCount: 1, source: 'telegram', status: 'pending', actor: 't' });
    await q(`UPDATE conversations SET guest_id=$1 WHERE external_id='700'`, [r.guest_id]);
    sent.length = 0;
    return r;
  }

  it('same event never schedules twice (idempotent), and sends exactly once', async () => {
    const r = await pendingWithChat();
    await scanAndSchedule(); await scanAndSchedule(); await scanAndSchedule();
    const n = (await q(`SELECT count(*)::int n FROM scheduled_messages WHERE kind='pending_reminder' AND reservation_id=$1`, [r.id]))[0].n;
    expect(n).toBe(1);
    await run(); await run();
    expect(sent.filter((s) => /still being reviewed/.test(s.text))).toHaveLength(1);
    expect((await q(`SELECT status FROM scheduled_messages WHERE kind='pending_reminder'`))[0].status).toBe('sent');
  });

  it('is skipped (not sent) when the reservation was confirmed or cancelled before it fired', async () => {
    const r = await pendingWithChat();
    await scanAndSchedule();
    await q(`UPDATE reservations SET status='confirmed' WHERE id=$1`, [r.id]); // state changed without explicit cancel
    await run();
    expect(sent.filter((s) => /still being reviewed/.test(s.text))).toHaveLength(0);
    expect((await q(`SELECT status, skip_reason FROM scheduled_messages WHERE kind='pending_reminder'`))[0]).toMatchObject({ status: 'skipped' });
  });

  it('confirming/cancelling cancels the pending follow-ups explicitly', async () => {
    const r = await pendingWithChat();
    await scanAndSchedule();
    await confirmReservation(r.id, 'staff', null);
    expect((await q(`SELECT status FROM scheduled_messages WHERE kind='pending_reminder'`))[0].status).toBe('cancelled');
    const r2 = await createReservation({ guest: guest('G2'), roomTypeId: inv.dorm, checkIn: d(20), checkOut: d(21), guestsCount: 1, source: 'website', status: 'pending', actor: 't' });
    await scanAndSchedule(); await cancelReservation(r2.id, 'x', 'staff');
    expect((await q(`SELECT status FROM scheduled_messages WHERE reservation_id=$1 AND kind='pending_reminder'`, [r2.id]))[0].status).toBe('cancelled');
  });

  it('never messages a guest whose conversation is owned by staff, or who opted out', async () => {
    const r = await pendingWithChat();
    await scanAndSchedule();
    await q(`UPDATE conversations SET mode='human' WHERE external_id='700'`);
    await run();
    expect((await q(`SELECT skip_reason FROM scheduled_messages WHERE kind='pending_reminder'`))[0].skip_reason).toBe('staff has taken over');
    await q(`UPDATE conversations SET mode='bot' WHERE external_id='700'`);
    await q(`UPDATE guests SET opted_out=true WHERE id=$1`, [r.guest_id]);
    await schedule('pending_reminder', new Date(Date.now() - 1000), 'manual:optout', { reservationId: r.id, guestId: r.guest_id });
    await run();
    expect((await q(`SELECT skip_reason FROM scheduled_messages WHERE dedupe_key='manual:optout'`))[0].skip_reason).toBe('guest opted out');
    expect(sent).toHaveLength(0);
  });

  it('retries a failed send with back-off and stops after max attempts', async () => {
    const r = await pendingWithChat();
    await q(`UPDATE automation_rules SET max_attempts=2, retry_minutes=0 WHERE kind='pending_reminder'`);
    await schedule('pending_reminder', new Date(Date.now() - 1000), 'manual:retry', { reservationId: r.id, guestId: r.guest_id });
    const failing = () => runDue(async () => { throw new Error('telegram down'); }, async () => {});
    await failing();
    expect((await q(`SELECT status, attempts FROM scheduled_messages WHERE dedupe_key='manual:retry'`))[0]).toMatchObject({ status: 'pending', attempts: 1 });
    await failing();
    expect((await q(`SELECT status, last_error FROM scheduled_messages WHERE dedupe_key='manual:retry'`))[0]).toMatchObject({ status: 'failed', last_error: 'telegram down' });
  });

  it('stale date-based reminders are dropped after a stay was extended or moved', async () => {
    const r = await pendingWithChat();
    await confirmReservation(r.id, 'staff', null);
    await schedule('checkout_reminder', new Date(Date.now() - 1000), `checkout:${r.id}:${d(12)}`, { reservationId: r.id, guestId: r.guest_id });
    await q(`UPDATE reservations SET check_out=$2 WHERE id=$1`, [r.id, d(14)]);
    await run();
    expect((await q(`SELECT status FROM scheduled_messages WHERE kind='checkout_reminder'`))[0].status).toBe('skipped');
  });
});
afterAll(closePool);
