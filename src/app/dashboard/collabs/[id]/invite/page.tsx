import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { PageHeader, Card, Flash, Btn, BtnGhost, Input, Lbl, Pill, dt } from '@/components/dash';
import { Icon } from '@/components/icons';
import { ConfirmButton } from '@/components/ConfirmButton';
import { getCollab, contactsFor, listInvites } from '@/services/collabs';
import { mailEnabled } from '@/lib/mailer';
import { collabInviteAction } from '../../actions';
import { InvitePicker } from './picker';

export const dynamic = 'force-dynamic';

/**
 * Invite people to a collab event by e-mail: everyone who left an e-mail at an earlier collab or event (pick all or
 * some), plus any e-mails written here, with a message of your own. Each person gets their own e-mail with the
 * event, a "Get your ticket" button and a link to stop invitations.
 */
export default async function InvitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('events.manage');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const c = await getCollab(id);
  if (!c) notFound();
  const [contacts, sent] = await Promise.all([contactsFor(id), listInvites(id)]);
  const title = c.title.en || c.title.ar;
  return (
    <>
      <PageHeader title={`Invite people · ${title}`} sub="Send the event to people who came before (their e-mail from earlier tickets and bookings) and to any e-mails you add. Each person gets their own e-mail.">
        <Link href={`/dashboard/collabs/${id}`} className={BtnGhost}><Icon name="chevron-left" size={16} /> Back to the event</Link>
      </PageHeader>
      <Flash sp={sp} />
      {!mailEnabled() && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">E-mail is not set up on the server yet: add <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>MAIL_FROM</code> to <code>.env</code>, then deploy. Until then nothing can be sent.</p>}
      {!c.active && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This event is hidden: people who open the invitation will not see it. Tick «Page is live» on the event first.</p>}

      <form action={collabInviteAction} className="grid gap-5 xl:grid-cols-3">
        <input type="hidden" name="id" value={id} />
        <div className="xl:col-span-2">
          <Card title={`People who came before · ${contacts.length}`}>
            <InvitePicker contacts={contacts} />
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="More e-mails (optional)">
            <Lbl htmlFor="iv-x">E-mails not in the list: one per line, or separated by commas</Lbl>
            <textarea id="iv-x" name="extra" rows={4} dir="ltr" className={Input} placeholder={'friend@example.com\nother@example.com'} />
          </Card>
          <Card title="The invitation">
            <div className="grid gap-3 text-sm">
              <div><Lbl htmlFor="iv-l">Language of the e-mail and the page it opens</Lbl>
                <select id="iv-l" name="lang" defaultValue="ar" className={Input}><option value="ar">Arabic</option><option value="en">English</option></select></div>
              <div><Lbl htmlFor="iv-s">Subject (optional)</Lbl><input id="iv-s" name="subject" className={Input} placeholder={`دعوة: ${c.title.ar || title} · فيلا ليلى & ${c.partner_name}`} /></div>
              <div><Lbl htmlFor="iv-m">Your message</Lbl>
                <textarea id="iv-m" name="message" rows={7} className={Input} defaultValue={`أهلاً {name}،\n\nعاملين ايفنت جديد مع ${c.partner_name} وحابين نشوفك معانا.\nاحجز تذكرتك من اللينك تحت.\n\nفيلا ليلى`} />
                <p className="mt-1 text-xs text-slate-500"><code>{'{name}'}</code> becomes each person’s first name. Under your message the e-mail shows the event photo, date, time, place and a «Get your ticket» button.</p></div>
              <ConfirmButton className={Btn + ' w-full justify-center py-3'} message="Send the invitation to everyone chosen?"><Icon name="message-square" size={16} /> Send invitations</ConfirmButton>
            </div>
          </Card>
        </div>
      </form>

      <Card title={`Sent · ${sent.length}`} className="mt-6">
        {sent.length === 0 ? <p className="text-sm text-slate-500">No invitations sent for this event yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-slate-600"><tr><th className="py-2">E-mail</th><th>Name</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{sent.map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-2" dir="ltr">{r.email}</td><td>{r.name ?? '—'}</td>
                <td>{r.status === 'sent' ? <Pill tone="green">Sent</Pill> : <span title={r.error ?? ''}><Pill tone="red">Failed</Pill></span>}</td>
                <td className="text-xs text-slate-500">{dt(r.created_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
