import { q } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

// InstaPay transfer screenshot — staff only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u || !can(u.role, 'frontdesk.use')) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const r = (await q<any>(`SELECT proof, proof_mime FROM online_payments WHERE id=$1 AND proof IS NOT NULL`, [id]))[0];
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(r.proof), { headers: { 'Content-Type': r.proof_mime || 'image/jpeg', 'Cache-Control': 'private, no-store' } });
}
