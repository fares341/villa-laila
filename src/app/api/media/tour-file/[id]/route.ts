import { q } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// Tour catalog file (PDF / image) — staff open it to send to the guest.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u || !can(u.role, 'frontdesk.use')) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const r = (await q<any>(`SELECT name, mime, bytes FROM tour_files WHERE id=$1`, [id]))[0];
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(r.bytes), {
    headers: { 'Content-Type': r.mime || 'application/octet-stream', 'Content-Disposition': `inline; filename="${encodeURIComponent(r.name)}"`, 'Cache-Control': 'private, max-age=300' },
  });
}
