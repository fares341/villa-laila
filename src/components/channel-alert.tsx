import { channelBlocksDue, channelReleasesDue } from '@/services/channel-blocks';
import { cmDoneAction, cmReleasedAction } from '@/app/dashboard/actions';
import { Icon } from './icons';

const SRC: Record<string, string> = { website: 'Website', walk_in: 'Walk-in', staff: 'Phone / direct', whatsapp: 'WhatsApp', telegram: 'Telegram' };
const d = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Top of every dashboard page: bookings that did not come through the channel manager (website, walk-in, phone)
 * and still need a block in Little Hotelier, so the booking sites don't sell the same bed. Ticked one by one.
 */
export async function ChannelAlert() {
  const [due, release] = await Promise.all([channelBlocksDue(), channelReleasesDue()]);
  if (!due.length && !release.length) return null;
  return (
    <section className="mb-5 overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50 text-amber-950 shadow-sm" aria-label="Channel manager">
      {due.length > 0 && (
        <div className="p-4">
          <p className="flex flex-wrap items-center gap-2 font-bold"><Icon name="alert-triangle" size={18} /> {due.length} booking{due.length > 1 ? 's' : ''} to block in the channel manager</p>
          <p className="mb-3 text-sm">New bookings that didn’t come through Little Hotelier, and extra nights from stay extensions. Close the same beds/dates there, then tick each one.</p>
          <ul className="grid gap-2">
            {due.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm">
                <span className="min-w-0 flex-1">
                  <b>{r.full_name}</b> · <a href={`/dashboard/reservations/${r.id}`} className="font-mono underline">{r.reference}</a>
                  {r.ext_to ? <span className="ms-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-900">Stay extended</span> : <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold">{SRC[r.source] ?? r.source}</span>}
                  {r.status === 'pending' && <span className="ms-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Needs your confirmation</span>}
                  <span className="block text-xs text-slate-600">{r.ext_from && r.ext_to ? <b className="text-sky-900">Block the extra nights {d(r.ext_from)} → {d(r.ext_to)} · </b> : <>{d(r.check_in)} → {d(r.check_out)} · </>} {r.guests_count} guest{r.guests_count > 1 ? 's' : ''} · {r.beds || r.room_type || '—'}</span>
                </span>
                {r.status === 'pending' && <a href={`/dashboard/reservations/${r.id}`} className="rounded-lg border border-cocoa-200 bg-white px-3 py-1.5 text-xs font-semibold text-cocoa-800">Review & confirm</a>}
                <form action={cmDoneAction}><input type="hidden" name="id" value={r.id} />
                  <button className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"><Icon name="check" size={14} /> Done in the channel manager</button></form>
              </li>
            ))}
          </ul>
        </div>
      )}
      {release.length > 0 && (
        <div className={`p-4 ${due.length ? 'border-t border-amber-200' : ''}`}>
          <p className="font-bold">{release.length} cancelled booking{release.length > 1 ? 's' : ''}: open the dates again in the channel manager</p>
          <ul className="mt-2 grid gap-2">
            {release.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm">
                <span className="min-w-0 flex-1"><b>{r.full_name}</b> · <span className="font-mono">{r.reference}</span> · {r.status.replace('_', ' ')}<span className="block text-xs text-slate-600">{r.ext_from && r.ext_to ? <b className="text-sky-900">Block the extra nights {d(r.ext_from)} → {d(r.ext_to)} · </b> : <>{d(r.check_in)} → {d(r.check_out)} · </>} {r.room_type ?? ''}</span></span>
                <form action={cmReleasedAction}><input type="hidden" name="id" value={r.id} />
                  <button className="inline-flex items-center gap-1 rounded-lg bg-cocoa-800 px-3 py-1.5 text-xs font-semibold text-white"><Icon name="check" size={14} /> Dates opened again</button></form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
