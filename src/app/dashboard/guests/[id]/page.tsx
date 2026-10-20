import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, Badge, Input, Lbl, Btn, BtnGhost, fmt, dt } from '@/components/dash';
import { updateGuestAction } from '../../actions';
import { todayLocal } from '@/lib/dates';

export default async function GuestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('guest.view');
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const g = (await q<any>('SELECT * FROM guests WHERE id=$1', [id]))[0];
  if (!g) notFound();
  const today = todayLocal();
  const stays = await q<any>(`SELECT r.*, folio_charges(r.id)::bigint charges_cents, COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.reservation_id=r.id AND p.status='verified'),0)::bigint paid FROM reservations r WHERE guest_id=$1 ORDER BY check_in DESC`, [id]);
  const convs = await q<any>(`SELECT c.id, c.status, c.mode, c.last_guest_message_at FROM conversations c WHERE guest_id=$1 ORDER BY updated_at DESC`, [id]);
  const msgs = await q<any>(`SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.guest_id=$1 ORDER BY m.created_at DESC LIMIT 15`, [id]);
  const tasks = await q<any>(`SELECT t.* FROM tasks t WHERE t.status='open' AND (t.reservation_id = ANY($1::uuid[]) OR t.conversation_id = ANY($2::uuid[]))`, [stays.map((s) => s.id), convs.map((c) => c.id)]);
  const current = stays.find((s) => s.status === 'checked_in'), upcoming = stays.filter((s) => ['confirmed', 'pending', 'hold'].includes(s.status) && s.check_in >= today);
  const owing = stays.filter((s) => ['confirmed', 'checked_in', 'checked_out'].includes(s.status)).reduce((a, s) => a + (s.charges_cents - s.paid), 0);
  return (
    <>
      <PageHeader title={g.full_name} sub={`Guest since ${dt(g.created_at)}`}><Link href="/dashboard/guests" className={BtnGhost}>← Guests</Link></PageHeader>
      <Flash sp={sp} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Stays">
            <p className="mb-3 text-sm">{current ? <>Currently staying: <Link className="underline" href={`/dashboard/reservations/${current.id}`}>{current.reference}</Link> until {current.check_out}. </> : 'Not staying now. '}Upcoming: {upcoming.length}. Outstanding balance: <b className={owing > 0 ? 'text-red-800' : ''}>{fmt(owing)}</b></p>
            {stays.length === 0 ? <p className="text-sm text-slate-500">No reservations.</p> : <table className="w-full text-sm"><tbody className="divide-y">{stays.map((s) => <tr key={s.id}><td className="py-2 font-mono"><Link className="underline" href={`/dashboard/reservations/${s.id}`}>{s.reference}</Link></td><td>{s.check_in} → {s.check_out}</td><td><Badge status={s.status} /></td><td>{fmt(s.total_cents, s.currency)}</td><td className="text-slate-500">paid {fmt(s.paid, s.currency)}</td></tr>)}</tbody></table>}
          </Card>
          <Card title="Recent messages">{msgs.length === 0 ? <p className="text-sm text-slate-500">No chat history.</p> : <ul className="space-y-1 text-sm">{msgs.map((m) => <li key={m.id}><span className="text-xs uppercase text-slate-400">{m.sender}</span> {m.text.slice(0, 200)}</li>)}</ul>}
            {convs.map((c) => <Link key={c.id} className="mt-2 block text-sm underline" href={`/dashboard/inbox/${c.id}`}>Open conversation</Link>)}</Card>
          {tasks.length > 0 && <Card title="Open follow-ups"><ul className="text-sm">{tasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul></Card>}
        </div>
        <Card title="Details">
          <form action={updateGuestAction} className="space-y-3"><input type="hidden" name="id" value={id} />
            <div><Lbl htmlFor="n">Full name</Lbl><input id="n" name="fullName" required defaultValue={g.full_name} className={Input} /></div>
            <div><Lbl htmlFor="p">Phone</Lbl><input id="p" name="phone" defaultValue={g.phone ?? ''} className={Input} /></div>
            <div><Lbl htmlFor="e">Email</Lbl><input id="e" name="email" type="email" defaultValue={g.email ?? ''} className={Input} /></div>
            <div><Lbl htmlFor="na">Nationality</Lbl><input id="na" name="nationality" defaultValue={g.nationality ?? ''} className={Input} /></div>
            <div><Lbl htmlFor="l">Preferred language</Lbl><select id="l" name="language" defaultValue={g.language} className={Input}><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="ar">العربية</option></select></div>
            <div><Lbl htmlFor="no">Operational notes</Lbl><textarea id="no" name="notes" rows={3} defaultValue={g.notes ?? ''} className={Input} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="optedOut" defaultChecked={g.opted_out} /> Do not send automatic messages (opted out)</label>
            <button className={Btn}>Save guest</button>
            <p className="text-xs text-slate-500">Identity documents are not stored in this system.</p></form>
        </Card>
      </div>
    </>
  );
}
