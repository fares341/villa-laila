import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, Input, Lbl, Btn, dt } from '@/components/dash';
import { uploadImportAction } from '../actions';

export default async function ImportHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('import.run');
  const sp = await searchParams;
  const batches = await q<any>(`SELECT b.id,b.filename,b.status,b.total_rows,b.imported_rows,b.rejected_rows,b.created_at,u.name FROM import_batches b LEFT JOIN users u ON u.id=b.uploaded_by ORDER BY b.created_at DESC LIMIT 20`);
  return (
    <>
      <PageHeader title="Import reservations from Excel / CSV" sub="Safe, in three steps: upload → check the columns and the preview → import. Nothing is saved until you press Import." />
      <Flash sp={sp} />
      <Card title="1. Upload your spreadsheet" className="max-w-2xl">
        <form action={uploadImportAction} encType="multipart/form-data" className="space-y-3">
          <div><Lbl htmlFor="file">File (.xlsx, .xls or .csv, first sheet, first row = column titles)</Lbl><input id="file" name="file" type="file" accept=".xlsx,.xls,.csv" required className={Input} /></div>
          <button className={Btn}>Upload & preview</button></form>
        <ul className="mt-4 list-disc ps-5 text-sm text-slate-600"><li>Your original file is kept inside the system as a backup.</li><li>Dates are read day-first (15/11/2026 = 15 November).</li><li>Problem rows are listed and skipped — you can fix the file and upload it again.</li><li>Create your rooms and beds first (Rooms & rates) so beds can be matched.</li></ul>
      </Card>
      <Card title="Previous imports" className="mt-6">
        {batches.length === 0 ? <p className="text-sm text-slate-500">No imports yet.</p> : <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>File</th><th>When</th><th>By</th><th>Status</th><th>Rows</th><th>Imported</th><th>Rejected</th></tr></thead><tbody className="divide-y">{batches.map((b) => <tr key={b.id}><td className="py-2"><Link className="underline" href={`/dashboard/import/${b.id}`}>{b.filename}</Link></td><td>{dt(b.created_at)}</td><td>{b.name}</td><td>{b.status}</td><td>{b.total_rows}</td><td>{b.imported_rows}</td><td>{b.rejected_rows}</td></tr>)}</tbody></table>}
      </Card>
    </>
  );
}
