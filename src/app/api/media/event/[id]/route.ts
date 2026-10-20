import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Event cover uploaded from the dashboard.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const r = (await q<any>(`SELECT image_bytes, image_mime FROM events WHERE id=$1 AND image_bytes IS NOT NULL`, [id]))[0];
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(r.image_bytes), { headers: { 'Content-Type': r.image_mime || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
}
