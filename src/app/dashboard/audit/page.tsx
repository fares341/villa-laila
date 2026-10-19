import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, dt } from '@/components/dash';

export default async function Audit() {
  await requireUser('audit.view');
  const rows = await q<any>('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');
  return (
    <>
      <PageHeader title="Activity log" sub="Who did what. Recorded automatically for bookings, payments, inventory, settings and sign-ins." />
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-600"><tr><th className="px-3 py-2">When</th><th>Who</th><th>Action</th><th>On</th><th>Detail</th></tr></thead><tbody className="divide-y">
        {rows.map((r) => <tr key={r.id}><td className="whitespace-nowrap px-3 py-1.5 text-xs">{dt(r.created_at)}</td><td>{r.actor}</td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.entity} {r.entity_id?.slice(0, 8)}</td><td className="max-w-xs truncate text-xs text-slate-500">{JSON.stringify(r.detail)}</td></tr>)}</tbody></table></div>
    </>
  );
}
