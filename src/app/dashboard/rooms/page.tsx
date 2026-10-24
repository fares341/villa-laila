import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, Input, Lbl, Btn, BtnGhost, fmt } from '@/components/dash';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Icon } from '@/components/icons';
import { saveRoomTypeAction, addRoomAction, addUnitsAction, toggleActiveAction, addRateAction, deleteRateAction, addBlockAction, deleteBlockAction } from '../actions';

const Toggle = ({ table, id, active }: { table: string; id: string; active: boolean }) => (
  <form action={toggleActiveAction} className="inline"><input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} />
    <ConfirmButton className="text-xs underline" message={active ? 'Make this inactive? It stops being offered for NEW bookings. Existing reservations are untouched.' : 'Make this active again?'}>{active ? 'Deactivate' : 'Activate'}</ConfirmButton></form>);

export default async function Rooms({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('inventory.manage');
  const sp = await searchParams;
  const types = await q<any>('SELECT * FROM room_types ORDER BY sort_order, code');
  const rooms = await q<any>('SELECT * FROM rooms ORDER BY name');
  const units = await q<any>('SELECT * FROM units ORDER BY label');
  const rates = await q<any>(`SELECT *, lower(valid_during) f, upper(valid_during) t FROM rates ORDER BY room_type_id, priority DESC, lower(valid_during)`);
  const blocks = await q<any>(`SELECT b.*, lower(during) f, upper(during) t, u.label, rm.name room FROM unit_blocks b JOIN units u ON u.id=b.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE upper(during) >= current_date ORDER BY lower(during)`);
  const allUnits = await q<any>(`SELECT u.id, u.label, rm.name room FROM units u JOIN rooms rm ON rm.id=u.room_id WHERE u.active ORDER BY rm.name, u.label`);
  const anyDemo = types.some((t) => t.is_demo);
  return (
    <>
      <PageHeader title="Rooms, beds & prices" sub="Changing rooms never alters past reservations: they are switched off, not deleted. The price of a night comes from the rates below; a rate with dates (season) wins over the base rate." />
      <Flash sp={sp} />
      {anyDemo && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><Icon name="alert-triangle" size={16} className="me-1 inline-block align-text-bottom" />You are looking at <b>DEMO</b> rooms and prices created for testing. Replace them with the real ones before going live (edit names, set real rates, deactivate the demo types).</p>}
      {types.map((t) => {
        const myRooms = rooms.filter((r) => r.room_type_id === t.id);
        return (
          <Card key={t.id} className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t.name.en} <span className="text-sm font-normal text-slate-500">({t.kind === 'dorm' ? 'priced per bed' : 'priced per room'}){t.is_demo ? ' · DEMO' : ''}{!t.active ? ' · INACTIVE' : ''}</span></h2><Toggle table="room_types" id={t.id} active={t.active} /></div>
            <details className="mt-2"><summary className="cursor-pointer text-sm text-lapis-600 underline">Edit name, description, amenities</summary>
              <form action={saveRoomTypeAction} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="id" value={t.id} />
                <div><Lbl>Gender</Lbl><select name="gender" defaultValue={t.gender} className={Input}><option value="mixed">Mixed</option><option value="female">Female only</option><option value="male">Male only</option></select></div>
                <div className="sm:col-span-2"><Lbl>Photo URLs (one per line, https only; first one is the cover)</Lbl><textarea name="photos" rows={3} defaultValue={(t.photos ?? []).join('\n')} className={Input} dir="ltr" /></div>
                {['en', 'es', 'fr', 'ar'].map((l) => <div key={l}><Lbl htmlFor={`n${t.id}${l}`}>Name ({l.toUpperCase()}){l === 'en' ? ' *' : ''}</Lbl><input id={`n${t.id}${l}`} name={`name_${l}`} defaultValue={t.name[l] ?? ''} className={Input} dir={l === 'ar' ? 'rtl' : 'ltr'} /></div>)}
                {['en', 'es', 'fr', 'ar'].map((l) => <div key={l}><Lbl htmlFor={`d${t.id}${l}`}>Description ({l.toUpperCase()})</Lbl><textarea id={`d${t.id}${l}`} rows={2} name={`desc_${l}`} defaultValue={t.description?.[l] ?? ''} className={Input} dir={l === 'ar' ? 'rtl' : 'ltr'} /></div>)}
                <div className="sm:col-span-2"><Lbl htmlFor={`a${t.id}`}>Amenities (one per line, English)</Lbl><textarea id={`a${t.id}`} name="amenities" rows={3} defaultValue={(t.amenities ?? []).map((a: any) => a.en).join('\n')} className={Input} /></div>
                <div><Lbl htmlFor={`s${t.id}`}>Sort order</Lbl><input id={`s${t.id}`} name="sort" type="number" defaultValue={t.sort_order} className={Input} /></div>
                <div className="flex items-end"><button className={Btn}>Save</button></div></form></details>

            <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">Rooms & beds</h3>
            {myRooms.length === 0 && <p className="text-sm text-slate-500">No rooms yet.</p>}
            {myRooms.map((r) => (
              <div key={r.id} className="mt-2 rounded-lg bg-slate-50 p-3 text-sm"><div className="flex items-center justify-between"><b>{r.name}{r.is_demo ? ' (demo)' : ''}</b><Toggle table="rooms" id={r.id} active={r.active} /></div>
                <div className="mt-2 flex flex-wrap gap-2">{units.filter((u) => u.room_id === r.id).map((u) => <span key={u.id} className={`rounded-full border px-2 py-0.5 text-xs ${u.active ? 'bg-white' : 'bg-slate-200 text-slate-500 line-through'}`}>{u.label}{u.capacity > 1 ? ` (${u.capacity})` : ''} <Toggle table="units" id={u.id} active={u.active} /></span>)}</div>
                <form action={addUnitsAction} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="roomId" value={r.id} />
                  <div><Lbl>Add</Lbl><input name="count" type="number" min={1} max={20} defaultValue={1} className={`${Input} w-20`} /></div>
                  <div><Lbl>Name starts with</Lbl><input name="prefix" defaultValue={t.kind === 'dorm' ? 'Bed' : 'Room'} className={`${Input} w-28`} /></div>
                  <div><Lbl>Guests each</Lbl><input name="capacity" type="number" min={1} defaultValue={t.kind === 'dorm' ? 1 : 2} className={`${Input} w-20`} /></div><button className={BtnGhost}>Add beds / rooms</button></form></div>))}
            <form action={addRoomAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="roomTypeId" value={t.id} />
              <div><Lbl>New room name</Lbl><input name="name" required className={Input} /></div>
              <div><Lbl>{t.kind === 'dorm' ? 'Number of beds' : 'Rooms'}</Lbl><input name="units" type="number" min={1} max={40} defaultValue={t.kind === 'dorm' ? 6 : 1} className={`${Input} w-24`} /></div>
              <div><Lbl>Guests each</Lbl><input name="capacity" type="number" min={1} defaultValue={t.kind === 'dorm' ? 1 : 2} className={`${Input} w-24`} /></div>
              <input type="hidden" name="prefix" value={t.kind === 'dorm' ? 'Bed' : 'Room'} /><button className={BtnGhost}>Add room</button></form>

            <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">Rates (per night, per {t.kind === 'dorm' ? 'bed' : 'room'})</h3>
            <ul className="mt-1 text-sm">{rates.filter((r) => r.room_type_id === t.id).map((r) => <li key={r.id} className="flex items-center gap-3 py-0.5">{fmt(r.price_cents)} · {r.name}{r.is_demo ? ' (DEMO price)' : ''} · {r.f || r.t ? `${r.f ?? '…'} → ${r.t ?? '…'} (seasonal, wins over base)` : 'base rate (always)'}
              <form action={deleteRateAction}><input type="hidden" name="id" value={r.id} /><ConfirmButton className="text-xs text-red-800 underline" message="Remove this rate? New quotes will use the next matching rate. Existing reservations keep their price.">remove</ConfirmButton></form></li>)}
              {rates.filter((r) => r.room_type_id === t.id).length === 0 && <li className="text-red-800">No rate set — this type cannot be priced or booked online.</li>}</ul>
            <form action={addRateAction} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="roomTypeId" value={t.id} />
              <div><Lbl>Price ({'EGP'})</Lbl><input name="price" required inputMode="decimal" className={`${Input} w-28`} /></div>
              <div><Lbl>Name</Lbl><input name="name" placeholder="Base / High season" className={`${Input} w-40`} /></div>
              <div><Lbl>From (optional)</Lbl><input type="date" name="from" className={Input} /></div><div><Lbl>Until, not incl. (optional)</Lbl><input type="date" name="to" className={Input} /></div><button className={BtnGhost}>Add rate</button></form>
          </Card>);
      })}
      <Card title="Add a room type" className="mb-5">
        <form action={saveRoomTypeAction} className="grid gap-3 sm:grid-cols-3">
          <div><Lbl>Name (English) *</Lbl><input name="name_en" required className={Input} /></div><div><Lbl>Name (Español)</Lbl><input name="name_es" className={Input} /></div><div><Lbl>Name (Français)</Lbl><input name="name_fr" className={Input} /></div>
          <div><Lbl>Name (Arabic)</Lbl><input name="name_ar" dir="rtl" className={Input} /></div>
          <div><Lbl>Short code (small letters, no spaces)</Lbl><input name="code" required pattern="[a-z0-9-]+" placeholder="mixed-dorm" className={Input} /></div>
          <div><Lbl>Kind</Lbl><select name="kind" className={Input}><option value="dorm">Shared dorm (per bed)</option><option value="private">Private room (per room)</option></select></div>
          <div><Lbl>Gender</Lbl><select name="gender" className={Input}><option value="mixed">Mixed</option><option value="female">Female only</option><option value="male">Male only</option></select></div>
          <div className="sm:col-span-3"><button className={Btn}>Create room type</button></div></form>
      </Card>
      <Card title="Maintenance blocks (bed out of service)">
        {blocks.length === 0 ? <p className="text-sm text-slate-500">No upcoming blocks.</p> : <ul className="mb-3 text-sm">{blocks.map((b) => <li key={b.id} className="flex gap-3 py-0.5">{b.room} / {b.label}: {b.f} → {b.t} {b.reason && `· ${b.reason}`}<form action={deleteBlockAction}><input type="hidden" name="id" value={b.id} /><ConfirmButton className="text-xs text-red-800 underline" message="Remove this block? The bed becomes available again.">remove</ConfirmButton></form></li>)}</ul>}
        <form action={addBlockAction} className="flex flex-wrap items-end gap-2">
          <div><Lbl>Bed / room</Lbl><select name="unitId" required className={Input}>{allUnits.map((u) => <option key={u.id} value={u.id}>{u.room} / {u.label}</option>)}</select></div>
          <div><Lbl>From</Lbl><input type="date" name="from" required className={Input} /></div><div><Lbl>Until (not incl.)</Lbl><input type="date" name="to" required className={Input} /></div>
          <div><Lbl>Reason</Lbl><input name="reason" className={Input} /></div><button className={BtnGhost}>Block</button></form>
      </Card>
    </>
  );
}
