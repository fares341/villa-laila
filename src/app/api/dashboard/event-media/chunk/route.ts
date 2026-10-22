import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { uploadPath, extFor, MAX_UPLOAD_BYTES } from '@/lib/uploads';
import { addEventMediaFile } from '@/services/event-content';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHUNK_MAX = 16 * 1024 * 1024;
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

/**
 * Upload a big file in pieces (the browser sends ~8 MB at a time, in order). Pieces are appended to a temp file;
 * the last piece moves it into the uploads folder and adds it to the event. No size limit besides MAX_UPLOAD_MB,
 * and nothing in the way (server-action limits, proxies) sees a request larger than one piece.
 */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || !can(u.role, 'events.manage')) return err('Sign in again', 401);
  const h = (k: string) => req.headers.get(k) ?? '';
  const uploadId = h('x-upload-id'), eventId = h('x-event-id');
  const index = parseInt(h('x-chunk-index'), 10), count = parseInt(h('x-chunk-count'), 10), total = parseInt(h('x-file-size'), 10);
  const mime = h('x-file-type') || 'application/octet-stream';
  const name = decodeURIComponent(h('x-file-name') || 'video');
  const kind = h('x-kind') === 'meal' ? 'meal' : h('x-kind') === 'hero' ? 'hero' : 'video';
  const orientation = h('x-orientation') === 'portrait' ? 'portrait' : 'landscape';
  if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !/^[0-9a-f-]{36}$/i.test(eventId)) return err('Bad upload');
  if (!(index >= 0 && count >= 1 && index < count && total > 0)) return err('Bad piece');
  if (total > MAX_UPLOAD_BYTES) return err(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  if (kind === 'hero' ? !/^(video|image)\//.test(mime) : kind === 'video' ? !/^video\//.test(mime) : !/^image\//.test(mime)) return err(kind === 'meal' ? 'Choose a photo' : kind === 'hero' ? 'Choose photos or a video' : 'Choose a video file (MP4, MOV…)');
  if (!(await q(`SELECT 1 FROM events WHERE id=$1`, [eventId])).length) return err('Event not found', 404);

  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > CHUNK_MAX) return err('Bad piece size');
  const tmpRel = `tmp/${uploadId}.part`;
  const tmp = uploadPath(tmpRel);
  await fs.promises.mkdir(path.dirname(tmp), { recursive: true });
  const offset = parseInt(h('x-offset'), 10);
  if (!(offset >= 0)) return err('Bad piece');
  if (index === 0 && offset === 0) await fs.promises.unlink(tmp).catch(() => {});
  const have = await fs.promises.stat(tmp).then((st) => st.size).catch(() => 0);
  // Pieces must arrive in order. A retried piece that was already stored is skipped; a gap asks the browser to resume.
  if (have === offset) await fs.promises.appendFile(tmp, body);
  else if (have !== offset + body.length) return NextResponse.json({ error: 'resume', have }, { status: 409 });
  if (index < count - 1) return NextResponse.json({ ok: true, received: index + 1 });

  const size = (await fs.promises.stat(tmp)).size;
  if (size !== total) { await fs.promises.unlink(tmp).catch(() => {}); return err('The file arrived incomplete, please try again', 409); }
  const rel = `events/${eventId}/${randomUUID()}.${extFor(mime, name)}`;
  await fs.promises.mkdir(path.dirname(uploadPath(rel)), { recursive: true });
  await fs.promises.rename(tmp, uploadPath(rel));
  const id = await addEventMediaFile(eventId, kind, rel, mime, size, orientation, u.email);
  return NextResponse.json({ ok: true, done: true, id });
}
