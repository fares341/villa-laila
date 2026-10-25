import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

// The meal photo of a weekday (0 = Sunday … 6 = Saturday), uploaded in Events → Weekly dinner menu.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-6]$/.test(id)) return new Response('Not found', { status: 404 });
  const r = (await q<any>(`SELECT photo, photo_mime FROM weekly_menu WHERE weekday=$1 AND photo IS NOT NULL`, [Number(id)]))[0];
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(r.photo), { headers: { 'Content-Type': r.photo_mime || 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable' } });
}
