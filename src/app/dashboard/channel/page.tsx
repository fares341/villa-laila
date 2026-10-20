import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost, Input, Lbl, Pill, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { channelOverview } from '@/services/pms/channel';
import { channelPull, channelImport, channelMapping, channelManualRate } from '../pms-actions';

export const dynamic = 'force-dynamic';

const nameOf = (n: any, code: string) => (n && typeof n === 'object' ? n.en || n.ar : n) || code;
const STATUS: Record<string, 'green' | 'red' | 'amber' | 'slate'> = { ok: 'green', error: 'red', queued: 'amber', skipped: 'slate' };

export default async function Channel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('channel.manage');
  const sp = await searchParams;
  const ov = await channelOverview();
  const today = todayLocal();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const rates = await q<any>(`SELECT room_type_id, rate_date, rate_cents, source FROM channel_daily_rates WHERE rate_date BETWEEN $1 AND $2`, [today, days[13]]);
  const cell = new Map(rates.map((r: any) => [`${r.room_type_id}|${r.rate_date}`, r]));
  // Local rate table per night, shown in grey where Little Hotelier has nothing.
  const fallback = new Map<string, number>();
  for (const t of ov.types) for (const d of days) {
    if (cell.has(`${t.id}|${d}`)) continue;
    const r = (await q<any>(`SELECT price_cents FROM rates WHERE room_type_id=$1 AND valid_during @> $2::date ORDER BY priority DESC, price_cents ASC LIMIT 1`, [t.id, d]))[0];
    if (r) fallback.set(`${t.id}|${d}`, Number(r.price_cents));
  }

  return (
    <>
      <PageHeader title="Little Hotelier" sub="Nightly rates come from Little Hotelier for each date. A night is always charged at the rate recorded for that date, never today’s rate times nights.">
        <form action={channelPull}><button className={Btn}><Icon name="refresh" size={16} /> Pull rates now</button></form>
      </PageHeader>
      <Flash sp={sp} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Connection" value={ov.connected ? 'Connected' : 'Not connected'} tone={ov.connected ? 'ok' : 'warn'} hint={ov.connected ? 'Partner endpoint configured' : 'Using CSV import + queue'} />
        <Stat label="Future dates with a rate" value={ov.stats?.future ?? 0} />
        <Stat label="Last update" value={ov.stats?.last_fetch ? dt(ov.stats.last_fetch) : 'Never'} />
        <Stat label="Updates to mirror" value={ov.queued} tone={ov.queued ? 'warn' : 'ok'} hint="Last 7 days, queued or failed" />
      </div>

      {!ov.connected && (
        <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Little Hotelier does not offer a public API. To sync automatically, ask SiteMinder for a partner endpoint and set <code>LH_API_BASE</code>, <code>LH_API_KEY</code> and <code>LH_PROPERTY_ID</code> in <code>.env</code>.
          Until then, export rates as CSV and import them below. Walk-ins, check-outs and room moves are listed in the sync log so you can mirror them in the Little Hotelier extranet.
        </p>
      )}

      <Card title="Rates for the next 14 days" className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead><tr className="text-left text-slate-500"><th className="py-2 pr-2">Room type</th>{days.map((d) => <th key={d} className="px-1 text-center">{d.slice(5)}</th>)}</tr></thead>
            <tbody>{ov.types.map((t: any) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="py-2 pr-2"><b className="text-sm">{nameOf(t.name, t.code)}</b><div className="text-slate-500">{t.channel_code ? `LH code ${t.channel_code}` : 'No LH code'}</div></td>
                {days.map((d) => {
                  const r: any = cell.get(`${t.id}|${d}`);
                  return <td key={d} className={`px-1 text-center tabular-nums ${r ? 'font-semibold text-cocoa-800' : 'text-slate-400'}`} title={r ? r.source : 'Rate table fallback'}>
                    {r ? Math.round(Number(r.rate_cents) / 100) : fallback.has(`${t.id}|${d}`) ? Math.round(fallback.get(`${t.id}|${d}`)! / 100) : '—'}</td>;
                })}
              </tr>))}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Bold = rate from Little Hotelier (or CSV). Grey = local rate table, used only when Little Hotelier has no rate for that date.</p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Import rates (CSV)">
          <form action={channelImport} className="space-y-3">
            <p className="text-sm text-slate-600">One line per night: <code>date,room_code,rate</code> (optional 4th column: rooms available). <code>room_code</code> is the Little Hotelier code or our room type code.</p>
            <input type="file" name="file" accept=".csv,text/csv,text/plain" className="block w-full text-sm" aria-label="CSV file" />
            <textarea name="csv" rows={5} placeholder={'2026-10-21,DORM8,450\n2026-10-21,DBL,1400'} className={Input + ' font-mono text-xs'} aria-label="CSV rows" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="overwritePast" /> Also replace rates of past nights</label>
            <p className="text-xs text-slate-500">Leave unticked: past nights keep the rate they had, so old bills never change.</p>
            <button className={BtnGhost}><Icon name="upload" size={16} /> Import</button>
          </form>
        </Card>

        <Card title="Room type codes">
          <form action={channelMapping} className="space-y-2">
            <p className="text-sm text-slate-600">Match each room type to its Little Hotelier room / rate plan ID.</p>
            {ov.types.map((t: any) => (
              <div key={t.id} className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <Lbl htmlFor={`c-${t.id}`}>{nameOf(t.name, t.code)} <span className="text-xs text-slate-400">({t.code})</span></Lbl>
                <input id={`c-${t.id}`} name={`code|${t.id}`} defaultValue={t.channel_code ?? ''} className={Input + ' font-mono'} />
              </div>
            ))}
            <button className={BtnGhost}>Save codes</button>
          </form>
        </Card>

        <Card title="Set one night manually">
          <form action={channelManualRate} className="space-y-3">
            <div><Lbl htmlFor="m-t">Room type</Lbl><select id="m-t" name="roomTypeId" className={Input}>{ov.types.map((t: any) => <option key={t.id} value={t.id}>{nameOf(t.name, t.code)}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Lbl htmlFor="m-d">Night</Lbl><input id="m-d" name="date" type="date" min={today} defaultValue={today} required className={Input} /></div>
              <div><Lbl htmlFor="m-r">Rate (EGP)</Lbl><input id="m-r" name="rate" type="number" min={0} step="0.01" required className={Input} /></div>
            </div>
            <p className="text-xs text-slate-500">For a single guest’s discount use the rate override on their folio instead.</p>
            <button className={BtnGhost}>Save rate</button>
          </form>
        </Card>
      </div>

      <Card title="Sync log" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Direction</th><th>Action</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>{ov.log.map((l: any) => (
              <tr key={l.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap py-2">{dt(l.created_at)}</td><td>{l.direction === 'out' ? 'To Little Hotelier' : 'From Little Hotelier'}</td><td>{l.action}</td>
                <td><Pill tone={STATUS[l.status] ?? 'slate'}>{l.status}</Pill></td>
                <td className="max-w-md truncate font-mono text-xs text-slate-500" title={JSON.stringify(l.payload)}>{l.error || JSON.stringify(l.payload)}</td>
              </tr>))}
              {ov.log.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">Nothing synced yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
