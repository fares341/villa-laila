import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, Input, Lbl, Btn, dt } from '@/components/dash';
import { saveRuleAction } from '../actions';

const HELP: Record<string, string> = {
  incomplete_booking: 'Guest started a booking in Telegram but did not finish. Delay = minutes of silence before nudging.',
  pending_reminder: 'Tell the guest their request is still under review (guest message). Delay = minutes after the request was made.',
  staff_unreviewed: 'Alert reception when a request has not been reviewed. Delay = minutes after the request was made.',
  payment_followup: 'Remind about an outstanding balance on confirmed stays. Delay = minutes after creation.',
  pre_arrival: 'Message before arrival. Sent at 10:00 hostel time on the arrival day minus this many minutes (1440 = 10:00 the day before).',
  checkin_reminder: 'Check-in day message, sent at 08:00 hostel time on the arrival day minus this many minutes.',
  checkout_reminder: 'Check-out day message with an “extend your stay” prompt, sent at 08:00 on departure day minus this many minutes.',
  extension_followup: 'Tell the guest an extension is still with reception. Delay = minutes after the request.',
  inquiry_unanswered: 'Alert reception when a guest message waits for an answer. Delay = minutes since the guest wrote.',
  escalation_unattended: 'Alert reception when an escalated chat has no assignee. Delay = minutes since escalation.',
  expiry_notice: 'Tell the guest a request expired (sent immediately).',
};
const STAFF = ['staff_unreviewed', 'inquiry_unanswered', 'escalation_unattended'];

export default async function Automation({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('automation.manage');
  const sp = await searchParams;
  const rules = await q<any>('SELECT * FROM automation_rules ORDER BY kind');
  const log = await q<any>(`SELECT s.*, g.full_name FROM scheduled_messages s LEFT JOIN guests g ON g.id=s.guest_id ORDER BY s.created_at DESC LIMIT 60`);
  return (
    <>
      <PageHeader title="Automation" sub="Messages are only sent if, at that moment, they still make sense (the booking is still pending, the chat is not taken over, the guest has not opted out). Each event can only create one message." />
      <Flash sp={sp} />
      <div className="space-y-3">{rules.map((r) => (
        <Card key={r.kind}>
          <form action={saveRuleAction} className="grid items-end gap-3 sm:grid-cols-[1.5fr_repeat(4,6rem)_auto_auto]"><input type="hidden" name="kind" value={r.kind} />
            <div><p className="font-semibold capitalize">{r.kind.replace(/_/g, ' ')} {STAFF.includes(r.kind) && <span className="rounded bg-slate-100 px-1.5 text-xs">staff alert</span>}</p><p className="text-xs text-slate-500">{HELP[r.kind]}</p></div>
            <div><Lbl>Delay (min)</Lbl><input name="delay" type="number" min={0} defaultValue={r.delay_minutes} className={Input} /></div>
            <div><Lbl>Max tries</Lbl><input name="attempts" type="number" min={1} defaultValue={r.max_attempts} className={Input} /></div>
            <div><Lbl>Retry (min)</Lbl><input name="retry" type="number" min={1} defaultValue={r.retry_minutes} className={Input} /></div>
            <div><Lbl>Max/guest/day</Lbl><input name="perDay" type="number" min={1} defaultValue={r.max_per_day} className={Input} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={r.enabled} /> On</label>
            <button className={Btn}>Save</button></form></Card>))}</div>
      <Card title="Delivery log (latest 60)" className="mt-6">
        {log.length === 0 ? <p className="text-sm text-slate-500">Nothing scheduled yet.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Type</th><th>Guest</th><th>Due</th><th>Status</th><th>Tries</th><th>Detail</th></tr></thead><tbody className="divide-y">{log.map((s) => (
          <tr key={s.id}><td className="py-1 capitalize">{s.kind.replace(/_/g, ' ')}</td><td>{s.full_name ?? '—'}</td><td>{dt(s.run_at)}</td><td><span className={s.status === 'sent' ? 'text-emerald-800' : s.status === 'failed' ? 'text-red-800' : s.status === 'pending' ? 'text-amber-800' : 'text-slate-500'}>{s.status}</span></td><td>{s.attempts}</td><td className="text-xs text-slate-500">{s.skip_reason ?? s.last_error ?? ''}</td></tr>))}</tbody></table></div>}
      </Card>
      <p className="mt-4 text-xs text-slate-500">Message wording lives in the translation files (English, Español, Français, العربية) and always states when a request is NOT yet confirmed.</p>
    </>
  );
}
