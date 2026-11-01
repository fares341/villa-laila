import { requireUser } from '@/lib/auth';
import { getCollab, listRsvps, csvOf } from '@/services/collabs';

export const dynamic = 'force-dynamic';

/** The sign-up list of a collab event as a spreadsheet (CSV). */
export async function GET(req: Request) {
  await requireUser('events.bookings');
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const c = await getCollab(id);
  if (!c) return new Response('Not found', { status: 404 });
  return new Response('﻿' + csvOf(await listRsvps(id)), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${c.slug}-list.csv"` },
  });
}
