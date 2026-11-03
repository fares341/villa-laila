import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader, Card, Flash, Btn, BtnGhost, Input, Lbl, Empty, Pill, dt } from '@/components/dash';
import { Icon } from '@/components/icons';
import { ConfirmButton } from '@/components/ConfirmButton';
import { listApplications, getHiringEmails, APP_STATUSES } from '@/services/applications';
import { applicationAction, hiringEmailsAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'blue' | 'amber' | 'cocoa' | 'green' | 'slate' }> = {
  new: { label: 'New', tone: 'blue' }, contacted: { label: 'Contacted', tone: 'amber' }, interview: { label: 'Interview', tone: 'cocoa' },
  accepted: { label: 'Accepted', tone: 'green' }, declined: { label: 'Declined', tone: 'slate' },
};
const avail = (a: string[] | null) => (a ?? []).map((x) => (x === 'full_time' ? 'Full-time' : 'Part-time')).join(' + ');
const ageOf = (d: string | null) => { const t = d ? Date.parse(d) : NaN; return Number.isFinite(t) ? Math.floor((Date.now() - t) / (365.25 * 864e5)) : null; };

/** Job and volunteer applications sent from the website page «Join our team». */
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('staff.view');
  const sp = await searchParams;
  const rows = await listApplications({ kind: sp.kind, status: sp.status });
  const emails = await getHiringEmails();
  const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ kind: sp.kind, status: sp.status, ...o })) if (v) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
  const tab = (label: string, o: Record<string, string | undefined>, on: boolean) => <Link href={`/dashboard/applications${qs(o)}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${on ? 'bg-cocoa-800 text-white' : 'text-cocoa-800'}`}>{label}</Link>;
  return (
    <>
      <PageHeader title="Job & volunteer applications" sub="Sent from the website page «Join our team» (/join). Change the status as you go; the newest are on top.">
        <a href="/en/join" target="_blank" rel="noopener" className={BtnGhost}><Icon name="external-link" size={16} /> Open the page</a>
        <a href={`/api/dashboard/applications-csv${qs({})}`} className={BtnGhost}><Icon name="download" size={16} /> Download (Excel / CSV)</a>
      </PageHeader>
      <Flash sp={sp} />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="inline-flex rounded-xl border border-cocoa-200 bg-white p-1">{tab('All', { kind: undefined }, !sp.kind)}{tab('Jobs', { kind: 'job' }, sp.kind === 'job')}{tab('Volunteers', { kind: 'volunteer' }, sp.kind === 'volunteer')}</div>
        <div className="inline-flex flex-wrap rounded-xl border border-cocoa-200 bg-white p-1">{tab('Any status', { status: undefined }, !sp.status)}{APP_STATUSES.map((s) => <span key={s}>{tab(STATUS[s].label, { status: s }, sp.status === s)}</span>)}</div>
      </div>

      {rows.length === 0 ? <Empty>No applications here yet. Share the link: villalaylahostel.com/en/join (Arabic: /ar/join).</Empty> : (
        <div className="space-y-4">
          {rows.map((r: any) => {
            const age = ageOf(r.birth_date);
            return (
              <Card key={r.id} id={`a-${r.id}`} title={`${r.full_name}${age != null ? ` · ${age}` : ''}`}>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <Pill tone={r.kind === 'volunteer' ? 'amber' : 'cocoa'}>{r.kind === 'volunteer' ? 'Volunteer' : 'Job'}</Pill>
                  <Pill tone={STATUS[r.status]?.tone ?? 'slate'}>{STATUS[r.status]?.label ?? r.status}</Pill>
                  <a className="underline" href={`https://wa.me/${String(r.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener" dir="ltr">{r.phone}</a>
                  {r.email && <a className="underline" href={`mailto:${r.email}`} dir="ltr">{r.email}</a>}
                  <span className="ms-auto text-xs text-slate-500">{dt(r.created_at)}</span>
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs font-semibold text-slate-500">Date of birth</dt><dd>{r.birth_date}</dd></div>
                  <div><dt className="text-xs font-semibold text-slate-500">Available for · rotating shifts</dt><dd>{avail(r.availability)} · {r.rotating_shifts === 'yes' ? 'shifts OK' : 'no rotating shifts'}</dd></div>
                  <div><dt className="text-xs font-semibold text-slate-500">Can start</dt><dd>{r.start_when}</dd></div>
                  {r.stay_length && <div><dt className="text-xs font-semibold text-slate-500">Can volunteer for</dt><dd>{r.stay_length}</dd></div>}
                  <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Languages</dt><dd className="whitespace-pre-line">{r.languages}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Experience</dt><dd className="whitespace-pre-line">{r.experience}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Why Villa Layla</dt><dd className="whitespace-pre-line">{r.why}</dd></div>
                  {r.note && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Anything else</dt><dd className="whitespace-pre-line">{r.note}</dd></div>}
                </dl>
                <form action={applicationAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-cocoa-100 pt-3 text-sm">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={qs({})} />
                  <div><Lbl htmlFor={`st-${r.id}`}>Status</Lbl>
                    <select id={`st-${r.id}`} name="status" defaultValue={r.status} className={Input}>{APP_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</select></div>
                  <div className="min-w-[220px] flex-1"><Lbl htmlFor={`nt-${r.id}`}>Note for the team</Lbl><input id={`nt-${r.id}`} name="staffNote" defaultValue={r.staff_note ?? ''} className={Input} /></div>
                  <button className={Btn}><Icon name="check" size={16} /> Save</button>
                  {can(u.role, 'staff.manage') && <ConfirmButton className={BtnGhost + ' text-red-700'} name="op" value="delete" message="Delete this application?">Delete</ConfirmButton>}
                </form>
              </Card>
            );
          })}
        </div>
      )}

      {can(u.role, 'staff.manage') && (
        <Card title="Send new applications to these e-mails" className="mt-6">
          <form action={hiringEmailsAction} className="grid gap-2 text-sm">
            <textarea name="emails" rows={3} dir="ltr" defaultValue={emails.join('\n')} className={Input} placeholder={'you@villalaylahostel.com'} />
            <p className="text-xs text-slate-500">One per line. Every new application is also sent to the owner’s Telegram.</p>
            <div><button className={Btn}><Icon name="check" size={16} /> Save</button></div>
          </form>
        </Card>
      )}
    </>
  );
}
