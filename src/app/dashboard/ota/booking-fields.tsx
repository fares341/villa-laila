'use client';
import { useMemo, useState } from 'react';
import { Input, Lbl } from '@/components/dash-ui';
import { Icon } from '@/components/icons';

type RoomType = { id: string; name: string; kind: 'dorm' | 'private' };
type Unit = { id: string; label: string; room: string; room_type_id: string; kind: string; capacity: number };
type Busy = { unit_id: string; s: string; e: string; who: string };

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/**
 * Room type, dates, guests and the exact bed(s) / room for a booking. Beds already taken on those dates are shown and
 * can't be picked, so the booking lands on the calendar exactly where reception put it.
 */
export function BookingFields({ types, units, busy, today, siteLabel, siteLink, siteParams }: {
  types: RoomType[]; units: Unit[]; busy: Busy[]; today: string;
  siteLabel?: string; siteLink?: string | null; siteParams?: 'booking_com' | 'airbnb' | 'hostelworld' | 'expedia' | 'agoda' | null;
}) {
  // Start on the first room type that still has something free tonight.
  const firstFree = types.find((t) => units.some((u) => u.room_type_id === t.id && !busy.some((b) => b.unit_id === u.id && b.s < addDays(today, 1) && today < b.e)));
  const [typeId, setTypeId] = useState(firstFree?.id ?? types[0]?.id ?? '');
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(addDays(today, 1));
  const [guests, setGuests] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const type = types.find((t) => t.id === typeId);
  const datesOk = checkOut > checkIn;

  const rows = useMemo(() => units.filter((u) => u.room_type_id === typeId).map((u) => {
    const taken = datesOk ? busy.find((b) => b.unit_id === u.id && b.s < checkOut && checkIn < b.e) : undefined;
    return { ...u, taken };
  }), [units, busy, typeId, checkIn, checkOut, datesOk]);
  const free = rows.filter((r) => !r.taken).length;
  const need = type?.kind === 'dorm' ? guests : 1;

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickedHere = picked.filter((id) => rows.some((r) => r.id === id && !r.taken));

  const siteUrl = (() => {
    if (!siteLink || !siteParams || !datesOk) return null;
    try {
      const u = new URL(siteLink);
      const p: Record<string, string> = siteParams === 'booking_com' ? { checkin: checkIn, checkout: checkOut, group_adults: String(guests), no_rooms: '1', group_children: '0', selected_currency: 'EGP' }
        : siteParams === 'airbnb' ? { check_in: checkIn, check_out: checkOut, adults: String(guests) }
        : siteParams === 'hostelworld' ? { from: checkIn, to: checkOut, guests: String(guests) }
        : siteParams === 'agoda' ? { checkIn, los: String(Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 864e5))), adults: String(guests), rooms: '1', currency: 'EGP' }
        : { chkin: checkIn, chkout: checkOut, rm1: `a${guests}` };
      for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
      return u.toString();
    } catch { return null; }
  })();

  return (
    <>
      <div><Lbl htmlFor="o-rt">Room type *</Lbl>
        <select id="o-rt" name="roomTypeId" required className={Input} value={typeId} onChange={(e) => { setTypeId(e.target.value); setPicked([]); }}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.kind === 'dorm' ? 'per bed' : 'private'})</option>)}
        </select></div>
      <div className="grid grid-cols-3 gap-3">
        <div><Lbl htmlFor="o-ci">Check-in *</Lbl><input id="o-ci" name="checkIn" type="date" required value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1)); }} className={Input} /></div>
        <div><Lbl htmlFor="o-co">Check-out *</Lbl><input id="o-co" name="checkOut" type="date" required min={addDays(checkIn, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={Input} /></div>
        <div><Lbl htmlFor="o-g">Guests *</Lbl><input id="o-g" name="guests" type="number" min={1} max={40} required value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} className={Input} /></div>
      </div>

      <fieldset className="rounded-lg border border-cocoa-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-700">{type?.kind === 'dorm' ? 'Beds' : 'Room'} <span className="font-normal text-slate-500">· {free} free of {rows.length} for these nights</span></legend>
        {!datesOk ? <p className="text-sm text-red-800">Check-out must be after check-in.</p> : rows.length === 0 ? <p className="text-sm text-slate-500">No beds or rooms of this type yet.</p> : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {rows.map((r) => {
              const on = pickedHere.includes(r.id);
              return (
                <label key={r.id} title={r.taken ? `Taken: ${r.taken.who}` : undefined}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${r.taken ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through' : on ? 'border-emerald-600 bg-emerald-50 font-semibold text-emerald-900' : 'border-cocoa-200 bg-white hover:border-cocoa-600'}`}>
                  <input type="checkbox" name="unitId" value={r.id} disabled={!!r.taken} checked={on} onChange={() => toggle(r.id)} className="accent-emerald-700" />
                  <span>{r.kind === 'dorm' ? `${r.room} · ${r.label}` : r.room}</span>
                </label>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {pickedHere.length === 0 ? `Leave empty to pick ${need > 1 ? `${need} free beds` : 'a free one'} automatically.`
            : type?.kind === 'dorm' && pickedHere.length !== guests ? <span className="text-amber-800">{pickedHere.length} bed(s) picked for {guests} guest(s).{pickedHere.length < guests ? ' The other beds are picked automatically, in the same room first.' : ' One bed per guest is usual.'}</span>
            : `${pickedHere.length} picked. The booking goes on exactly ${pickedHere.length > 1 ? 'these' : 'this'} in the calendar.`}
          {free < need && datesOk && <span className="block text-red-800">Not enough free {type?.kind === 'dorm' ? 'beds' : 'rooms'} of this type for these nights.</span>}
        </p>
      </fieldset>

      {siteLabel && (siteUrl
        ? <a href={siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-lapis-700 underline"><Icon name="external-link" size={14} /> See the price on {siteLabel} for these dates</a>
        : siteParams ? <p className="text-xs text-slate-500">Save the {siteLabel} link (right) to check its price for these dates in one click.</p> : null)}
    </>
  );
}
