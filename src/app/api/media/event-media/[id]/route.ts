import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Meal photos and videos uploaded for an event. Videos answer Range requests so phones can play and seek them.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const r = (await q<any>(`SELECT bytes, mime FROM event_media WHERE id=$1 AND bytes IS NOT NULL`, [id]))[0];
  if (!r) return new Response('Not found', { status: 404 });
  const buf: Buffer = r.bytes;
  const type = r.mime || 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800, immutable', 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (range) {
    const size = buf.length;
    let start = range[1] ? parseInt(range[1], 10) : size - parseInt(range[2] || '0', 10);
    let end = range[1] && range[2] ? parseInt(range[2], 10) : size - 1;
    if (!range[1]) end = size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(new Uint8Array(buf.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
  }
  return new Response(new Uint8Array(buf), { headers: { ...headers, 'Content-Length': String(buf.length) } });
}
