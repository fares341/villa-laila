import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, dt, Input, Lbl, Btn, BtnGhost } from '@/components/dash';
import { ConfirmButton } from '@/components/ConfirmButton';
import { takeOverAction, replyAction, resolveAction, reopenAction, resumeBotAction, assignAction } from '../../actions';

export default async function Conversation({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser('inbox.use');
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = (await q<any>(`SELECT c.*, g.full_name, g.phone, g.language glang, u.name staff, r.reference FROM conversations c LEFT JOIN guests g ON g.id=c.guest_id LEFT JOIN users u ON u.id=c.assigned_to LEFT JOIN reservations r ON r.id=c.reservation_id WHERE c.id=$1`, [id]))[0];
  if (!c) notFound();
  const msgs = await q<any>('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at LIMIT 300', [id]);
  const staff = await q<any>('SELECT id,name FROM users WHERE active ORDER BY name');
  const mine = c.mode === 'human' && c.assigned_to === me.id;
  const owner = c.mode === 'human' && c.assigned_to && c.assigned_to !== me.id;
  return (
    <>
      <PageHeader title={c.full_name ?? `Telegram chat ${c.external_id}`} sub={`${c.channel} · language ${c.language ?? '?'}${c.reference ? ' · reservation ' + c.reference : ''}`}><Link href="/dashboard/inbox" className={BtnGhost}>← Inbox</Link></PageHeader>
      <Flash sp={sp} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Conversation">
            <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
              {msgs.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
              {msgs.map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-white' : m.sender === 'staff' ? 'bg-emerald-100' : 'bg-sky-100'}`}>
                    <p className="mb-0.5 text-[10px] uppercase text-slate-500">{m.sender}{m.kind === 'voice' ? ' · voice (transcribed)' : ''} · {dt(m.created_at)}{m.delivery_status === 'failed' ? ' · not delivered' : ''}</p>{m.text}</div></div>))}
            </div>
            {mine ? (
              <form action={replyAction} className="mt-4 space-y-2"><input type="hidden" name="id" value={id} /><Lbl htmlFor="tx">Reply to guest (sent on Telegram)</Lbl><textarea id="tx" name="text" rows={3} required className={Input} /><button className={Btn}>Send</button></form>
            ) : (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{owner ? `${c.staff} is handling this conversation.` : 'Take over to reply. This pauses the bot for this guest so you never talk over each other.'}</p>)}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Status">
            <dl className="space-y-1 text-sm"><div><dt className="inline text-slate-500">State: </dt><dd className="inline font-medium">{c.status.replace('_', ' ')}</dd></div>
              <div><dt className="inline text-slate-500">Bot: </dt><dd className="inline font-medium">{c.mode === 'human' ? '⏸ paused (staff)' : '▶ active'}</dd></div>
              <div><dt className="inline text-slate-500">Assigned: </dt><dd className="inline font-medium">{c.staff ?? 'nobody'}</dd></div>
              <div><dt className="inline text-slate-500">Priority: </dt><dd className="inline font-medium">{c.priority}</dd></div>
              <div><dt className="inline text-slate-500">Last guest message: </dt><dd className="inline">{dt(c.last_guest_message_at)}</dd></div></dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {!mine && !owner && <form action={takeOverAction}><input type="hidden" name="id" value={id} /><button className={Btn}>Take over</button></form>}
              {c.mode === 'human' && (mine || me.role !== 'receptionist') && <form action={resumeBotAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={BtnGhost} message="Let the bot answer this guest again?">Resume bot</ConfirmButton></form>}
              {c.status !== 'resolved' ? <form action={resolveAction}><input type="hidden" name="id" value={id} /><button className={BtnGhost}>Mark resolved</button></form> : <form action={reopenAction}><input type="hidden" name="id" value={id} /><button className={BtnGhost}>Reopen</button></form>}
            </div>
            <form action={assignAction} className="mt-4 flex items-end gap-2"><input type="hidden" name="id" value={id} /><div className="flex-1"><Lbl htmlFor="as">Assign to</Lbl><select id="as" name="userId" defaultValue={c.assigned_to ?? ''} className={Input}><option value="">Nobody</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><button className={BtnGhost}>Save</button></form>
          </Card>
          <Card title="Why it was escalated">
            <p className="text-sm"><b>Reason:</b> {c.escalation_reason ?? '—'}</p>
            <p className="mt-2 text-sm"><b>Recommended next action:</b> {c.recommended_action ?? '—'}</p>
            {c.missing_info && <p className="mt-2 text-sm"><b>Missing info:</b> {c.missing_info}</p>}
            <p className="mt-3 text-xs font-semibold uppercase text-slate-500">Summary</p><pre className="whitespace-pre-wrap text-sm text-slate-700">{c.summary ?? 'No summary yet.'}</pre>
            {c.flow === 'booking' && <p className="mt-3 text-xs text-slate-500">Guest was in a booking flow (step: {c.step}).</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
