import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader, Flash, Btn, BtnGhost, Empty, Pill } from '@/components/dash';
import { Icon } from '@/components/icons';
import { CopyButton } from '@/components/copy-button';
import { listCollabs } from '@/services/collabs';
import { siteBase } from '@/lib/base-url';

export const dynamic = 'force-dynamic';

/** Collaboration events: our event with a partner, each with its own page to share on Instagram stories. */
export default async function CollabsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('events.bookings');
  const sp = await searchParams;
  const canEdit = can(u.role, 'events.manage');
  const rows = await listCollabs();
  const base = await siteBase().catch(() => '');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Collab events" sub="Events you make with a partner. Each one has its own page (our logo × theirs, photos, meals, and a sign-up form) made to share on Instagram stories.">
        {canEdit && <Link href="/dashboard/collabs/new" className={Btn}><Icon name="plus" size={16} /> New collab event</Link>}
      </PageHeader>
      <Flash sp={sp} />
      {rows.length === 0 ? <Empty>No collab events yet. Make the first one with «New collab event».</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const link = `${base}/c/${c.slug}`;
            const past = c.event_date != null && c.event_date < today;
            return (
              <article key={c.id} className="flex flex-col overflow-hidden rounded-2xl border border-cocoa-200 bg-white">
                <div className="flex items-center justify-center gap-4 px-4 py-5" style={{ background: `linear-gradient(135deg, #2F2925, ${c.accent})` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/assets/logo-240.webp" alt="Villa Layla" className="h-12 w-auto rounded bg-white/95 p-1" />
                  <span className="text-xl font-light text-white/80">×</span>
                  {c.partner_logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.partner_logo} alt={c.partner_name} className="h-12 w-12 rounded-full bg-white object-cover" />
                    : <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-sm font-bold text-cocoa-800">{c.partner_name.slice(0, 2)}</span>}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-cocoa-900">{c.title.en || c.title.ar}</h3>
                    {!c.active ? <Pill tone="slate">Hidden</Pill> : past ? <Pill tone="amber">Done</Pill> : <Pill tone="green">Live</Pill>}
                  </div>
                  <p className="text-xs text-slate-500">with <b>{c.partner_name}</b>{c.event_date ? ` · ${c.event_date}` : ''}{c.start_time ? ` · ${c.start_time}` : ''}</p>
                  <p className="text-sm"><b className="text-lg tabular-nums text-cocoa-800">{c.people}</b> people signed up{c.capacity ? ` of ${c.capacity}` : ''} <span className="text-xs text-slate-500">({c.going} sign-ups)</span></p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <CopyButton text={link} label="Copy link" done="Copied" className={BtnGhost} />
                    <a href={`/c/${c.slug}`} target="_blank" rel="noopener" className={BtnGhost}>Open</a>
                    <Link href={`/dashboard/collabs/${c.id}`} className={Btn + ' ms-auto'}>{canEdit ? 'Edit & list' : 'List'}</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
