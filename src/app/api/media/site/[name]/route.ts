import fs from 'node:fs';
import { Readable } from 'node:stream';
import { uploadPath } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4' };

function range(h: string | null, size: number): [number, number] | 'bad' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || '');
  if (!m) return null;
  let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2] || '0', 10);
  let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
  start = Math.max(0, start); end = Math.min(size - 1, end);
  return start > end ? 'bad' : [start, end];
}

/** Photos and videos uploaded in Website management (room photos, day-trip photos, guest films). Videos answer Range requests. */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const m = /^([0-9a-f-]{36})\.([a-z0-9]{2,5})$/i.exec(name);
  if (!m) return new Response('Not found', { status: 404 });
  const p = uploadPath(`site/${m[1]}.${m[2].toLowerCase()}`);
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(p); } catch { return new Response('Not found', { status: 404 }); }
  const type = TYPES[m[2].toLowerCase()] ?? 'application/octet-stream';
  const rg = range(req.headers.get('range'), stat.size);
  if (rg === 'bad') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
  const [start, end] = rg ?? [0, stat.size - 1];
  const body = Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream;
  return new Response(body, {
    status: rg ? 206 : 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(rg ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) },
  });
}
