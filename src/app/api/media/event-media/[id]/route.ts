import fs from 'node:fs';
import { Readable } from 'node:stream';
import { q } from '@/lib/db';
import { uploadPath } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

const CACHE = 'public, max-age=604800, immutable';

/** Byte range from a Range header, or null for the whole file. */
function range(h: string | null, size: number): [number, number] | 'bad' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || '');
  if (!m) return null;
  let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2] || '0', 10);
  let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
  start = Math.max(0, start); end = Math.min(size - 1, end);
  return start > end ? 'bad' : [start, end];
}

// Meal photos and videos of an event. Videos stream from the uploads folder and answer Range requests,
// so phones can start playing and seek without downloading the whole file.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const r = (await q<any>(`SELECT file_path, mime, (bytes IS NOT NULL) has_bytes FROM event_media WHERE id=$1`, [id]))[0];
  if (!r) return new Response('Not found', { status: 404 });
  const type = r.mime || 'application/octet-stream';

  if (r.file_path) {
    let stat: fs.Stats;
    const p = uploadPath(r.file_path);
    try { stat = await fs.promises.stat(p); } catch { return new Response('Not found', { status: 404 }); }
    const rg = range(req.headers.get('range'), stat.size);
    if (rg === 'bad') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    const [start, end] = rg ?? [0, stat.size - 1];
    const body = Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream;
    return new Response(body, {
      status: rg ? 206 : 200,
      headers: { 'Content-Type': type, 'Cache-Control': CACHE, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(rg ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) },
    });
  }

  const b = (await q<any>(`SELECT bytes FROM event_media WHERE id=$1`, [id]))[0];
  if (!b?.bytes) return new Response('Not found', { status: 404 });
  const buf: Buffer = b.bytes;
  const rg = range(req.headers.get('range'), buf.length);
  if (rg === 'bad') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buf.length}` } });
  const [start, end] = rg ?? [0, buf.length - 1];
  return new Response(new Uint8Array(buf.subarray(start, end + 1)), {
    status: rg ? 206 : 200,
    headers: { 'Content-Type': type, 'Cache-Control': CACHE, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(rg ? { 'Content-Range': `bytes ${start}-${end}/${buf.length}` } : {}) },
  });
}
