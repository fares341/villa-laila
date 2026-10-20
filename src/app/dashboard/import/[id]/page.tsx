import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { FIELDS, FIELD_LABEL, validateRows, type Mapping } from '@/services/import';
import { PageHeader, Card, Flash, Input, Lbl, Btn, BtnGhost } from '@/components/dash';
import { ConfirmButton } from '@/components/ConfirmButton';
import { remapImportAction, commitImportAction } from '../../actions';

export default async function ImportBatch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('import.run');
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const b = (await q<any>('SELECT id,filename,status,mapping,report,total_rows,imported_rows,rejected_rows FROM import_batches WHERE id=$1', [id]))[0];
  if (!b) notFound();
  const headers: string[] = b.report.headers ?? [], rows: string[][] = b.report.rows ?? [];
  const types = await q<any>('SELECT id, name FROM room_types WHERE active ORDER BY sort_order');
  const mapping: Mapping = b.mapping ?? {};
  const done = b.status === 'imported';
  const prev = done ? null : await validateRows(rows, mapping, {});
  return (
    <>
      <PageHeader title={`Import: ${b.filename}`} sub={done ? 'Completed.' : `${b.total_rows} data row(s) found${b.report.truncated ? ' (only the first 5000 are read)' : ''}`}><Link className={BtnGhost} href="/dashboard/import">← Imports</Link></PageHeader>
      <Flash sp={sp} />
      {done ? (
        <Card title={`Imported ${b.imported_rows} · rejected ${b.rejected_rows}`}>
          {(b.report.rejected ?? []).length > 0 ? <><p className="mb-2 text-sm">Rejected rows (fix them in the file and upload again):</p><ul className="max-h-96 overflow-auto text-sm">{b.report.rejected.map((r: any) => <li key={r.row} className="py-0.5"><b>Row {r.row}</b>: {r.reason}</li>)}</ul></> : <p className="text-sm">All rows were imported.</p>}
        </Card>
      ) : (
        <>
          <Card title="2. Which column is which?">
            <form action={remapImportAction} className="grid gap-3 sm:grid-cols-3"><input type="hidden" name="id" value={id} />
              {FIELDS.map((f) => <div key={f}><Lbl htmlFor={`m_${f}`}>{FIELD_LABEL[f]}</Lbl><select id={`m_${f}`} name={`map_${f}`} defaultValue={mapping[f] ?? ''} className={Input}><option value="">— not in my file —</option>{headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}</select></div>)}
              <div className="flex items-end"><button className={BtnGhost}>Update preview</button></div></form>
          </Card>
          <Card title={`3. Preview — ${prev!.summary.ok} ready, ${prev!.summary.rejected} problem row(s), ${prev!.summary.warnings} with warnings`} className="mt-5">
            <div className="max-h-[28rem] overflow-auto rounded-lg border"><table className="min-w-full text-xs"><thead className="sticky top-0 bg-slate-50 text-left"><tr><th className="px-2 py-1">Row</th><th>Guest</th><th>Dates</th><th>Guests</th><th>Bed</th><th>Status</th><th>Total</th><th>Paid</th><th>Check</th></tr></thead><tbody className="divide-y">
              {prev!.results.slice(0, 300).map((r) => <tr key={r.rowNo} className={r.ok ? '' : 'bg-red-50'}><td className="px-2 py-1">{r.rowNo}</td><td>{r.data.name}</td><td className="whitespace-nowrap">{r.data.checkIn} → {r.data.checkOut}</td><td>{r.data.guests}</td><td>{r.data.room}{r.data.unitId ? ' (matched)' : ''}</td><td>{r.data.status}</td><td>{r.data.totalCents != null ? r.data.totalCents / 100 : ''}</td><td>{(r.data.paidCents ?? 0) / 100}</td>
                <td>{r.errors.map((e, i) => <span key={i} className="block text-red-800">Error: {e}</span>)}{r.warnings.map((e, i) => <span key={i} className="block text-amber-800">Warning: {e}</span>)}{r.ok && !r.warnings.length && <span className="text-emerald-800">OK</span>}</td></tr>)}</tbody></table></div>
            {prev!.results.length > 300 && <p className="mt-1 text-xs text-slate-500">Showing the first 300 rows; all rows are checked on import.</p>}
            <form action={commitImportAction} className="mt-5 space-y-3 border-t pt-4"><input type="hidden" name="id" value={id} />
              <div className="max-w-sm"><Lbl htmlFor="dt">Room type for stays whose bed is unknown (they get any free bed of this type)</Lbl><select id="dt" name="defaultRoomTypeId" className={Input}><option value="">— none: such rows are rejected —</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name.en}</option>)}</select></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paidVerified" /> Treat “paid” amounts as already verified (they come from the hostel’s own records)</label>
              <ConfirmButton className={Btn} message={`Import ${prev!.summary.ok} reservation(s) now? Problem rows are skipped and listed afterwards.`}>Import {prev!.summary.ok} reservation(s)</ConfirmButton></form>
          </Card>
        </>)}
    </>
  );
}
