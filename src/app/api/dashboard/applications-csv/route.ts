import { requireUser } from '@/lib/auth';
import { listApplications, appsCsv } from '@/services/applications';

export const dynamic = 'force-dynamic';

/** Job / volunteer applications as a spreadsheet (CSV). */
export async function GET(req: Request) {
  await requireUser('staff.view');
  const u = new URL(req.url);
  const rows = await listApplications({ kind: u.searchParams.get('kind') ?? undefined, status: u.searchParams.get('status') ?? undefined });
  return new Response('﻿' + appsCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="applications.csv"' } });
}
