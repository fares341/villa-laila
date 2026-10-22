// Background worker: Telegram long-polling + scheduled follow-ups + hold expiry. Run with `npm run worker`.
// State is in Postgres, so it can be restarted at any time without losing conversations or follow-ups.
import { env } from '@/lib/env';
import { tx, q } from '@/lib/db';
import type { Q } from '@/lib/db';
import { tg } from './telegram';
import { handleTelegramUpdate } from './flow';
import { sweepExpired } from '@/services/reservations';
import { sweepMovedOutRooms } from '@/services/pms/frontdesk';
import { syncCurrentRun } from '@/services/pms/tasks';
import { scanAndSchedule, runDue, schedule } from '@/services/followups';
import { botSend, notifyStaff } from '@/services/conversations';
import { syncHostelworldData } from '@/services/hostelworld-sync';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...a);

async function tick() {
  try {
    const expired = await tx((c) => sweepExpired(c as unknown as Q));
    for (const id of expired) {
      const r = (await q<any>('SELECT guest_id FROM reservations WHERE id=$1', [id]))[0];
      await schedule('expiry_notice', new Date(), `expiry:${id}`, { reservationId: id, guestId: r?.guest_id });
    }
    const moved = await sweepMovedOutRooms();
    if (moved) log('rooms vacated by a room move marked dirty:', moved);
    await syncCurrentRun().catch((e) => console.error('[tasks]', e));
    await scanAndSchedule();
    const n = await runDue(async (conv, text, kb) => botSend(conv, text, kb), notifyStaff);
    if (n) log('processed follow-ups:', n);
  } catch (e) { console.error('[tick]', e); }
}

async function pollLoop() {
  if (!env.botToken) { log('TELEGRAM_BOT_TOKEN not set — bot polling disabled (follow-up scheduler still runs).'); return; }
  try { const me = await tg.getMe(); log('Telegram bot connected as @' + me.username); await tg.deleteWebhook(); } catch (e) { log('Cannot reach Telegram:', (e as Error).message); }
  let offset = 0;
  const last = (await q<any>(`SELECT max(update_id) m FROM processed_updates WHERE channel='telegram'`))[0]?.m;
  if (last) offset = Number(last) + 1;
  for (;;) {
    try {
      const updates = await tg.getUpdates(offset, 25);
      for (const u of updates) {
        offset = u.update_id + 1;
        try { await handleTelegramUpdate(u); } catch (e) { console.error('[update]', u.update_id, e); }
      }
    } catch (e) { console.error('[poll]', (e as Error).message); await new Promise((r) => setTimeout(r, 5000)); }
  }
}

async function main() {
  if (!env.databaseUrl) throw new Error('DATABASE_URL not set');
  log('starting');
  setInterval(tick, 30_000);
  void tick();

  // Periodic Hostelworld rates and availability sync (every 30 mins)
  setInterval(() => {
    syncHostelworldData({ force: true })
      .then((res) => log('Hostelworld sync completed:', Object.keys(res.rooms).length, 'rooms updated'))
      .catch((e) => console.error('[worker-hw-sync]', e));
  }, 30 * 60 * 1000);
  void syncHostelworldData().catch(() => {});

  await pollLoop();
  // if polling is disabled, keep the process alive for the scheduler
  await new Promise(() => {});
}
main().catch((e) => { console.error(e); process.exit(1); });
