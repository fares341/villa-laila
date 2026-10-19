import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { createReservationAction } from '../../actions';
import { PageHeader, Card, Flash, Input, Lbl, Btn } from '@/components/dash';
import { todayLocal, addDays } from '@/lib/dates';
import { can } from '@/lib/permissions';

export default async function NewReservation({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('reservation.create');
  const sp = await searchParams;
  const types = await q<any>('SELECT id, name, kind FROM room_types WHERE active ORDER BY sort_order');
  const unit = sp.unit ? (await q<any>('SELECT u.id, u.label, rm.name room, rm.room_type_id FROM units u JOIN rooms rm ON rm.id=u.room_id WHERE u.id=$1', [sp.unit]))[0] : null;
  const t0 = todayLocal();
  return (
    <>
      <PageHeader title="New reservation" sub="Availability and price are checked by the system when you save." />
      <Flash sp={sp} />
      <Card className="max-w-3xl">
        <form action={createReservationAction} className="grid gap-4 sm:grid-cols-2">
          {unit && <input type="hidden" name="unitId" value={unit.id} />}
          <div className="sm:col-span-2"><Lbl htmlFor="fn">Guest full name *</Lbl><input id="fn" name="fullName" required className={Input} /></div>
          <div><Lbl htmlFor="ph">Phone / WhatsApp</Lbl><input id="ph" name="phone" className={Input} /></div>
          <div><Lbl htmlFor="em">Email</Lbl><input id="em" name="email" type="email" className={Input} /></div>
          <div><Lbl htmlFor="na">Nationality (only if asked by policy)</Lbl><input id="na" name="nationality" className={Input} /></div>
          <div><Lbl htmlFor="lg">Guest language</Lbl><select id="lg" name="language" className={Input}><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="ar">العربية</option></select></div>
          <div><Lbl htmlFor="rt">Room type *</Lbl><select id="rt" name="roomTypeId" required defaultValue={unit?.room_type_id} className={Input}>{types.map((t) => <option key={t.id} value={t.id}>{t.name.en} ({t.kind === 'dorm' ? 'per bed' : 'per room'})</option>)}</select></div>
          <div><Lbl htmlFor="gs">Number of guests *</Lbl><input id="gs" name="guests" type="number" min={1} max={40} defaultValue={1} required className={Input} /></div>
          <div><Lbl htmlFor="ci">Check-in *</Lbl><input id="ci" name="checkIn" type="date" required min={t0} defaultValue={sp.checkIn ?? t0} className={Input} /></div>
          <div><Lbl htmlFor="co">Check-out *</Lbl><input id="co" name="checkOut" type="date" required min={addDays(t0, 1)} defaultValue={sp.checkOut ?? addDays(t0, 1)} className={Input} /></div>
          <div className="sm:col-span-2"><Lbl htmlFor="st">Create as</Lbl>
            <select id="st" name="status" className={Input} defaultValue="pending">
              <option value="hold">Temporary hold (expires automatically)</option><option value="pending">Pending request (awaiting confirmation)</option>
              {can(u.role, 'reservation.confirm') && <option value="confirmed">Confirmed</option>}
            </select></div>
          {unit && <p className="sm:col-span-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">You clicked <b>{unit.room} / {unit.label}</b>. The system will try to assign that bed.</p>}
          <div className="sm:col-span-2"><Lbl htmlFor="no">Staff notes</Lbl><textarea id="no" name="notes" rows={2} className={Input} /></div>
          <div className="sm:col-span-2"><button className={Btn}>Create reservation</button></div>
        </form>
      </Card>
    </>
  );
}
