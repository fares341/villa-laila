import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { uploadPath, extFor, MAX_UPLOAD_BYTES } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHUNK_MAX = 16 * 1024 * 1024;
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

/**
 * Upload for Website management (photos and videos of any size), in ~8 MB pieces sent in order — the same protocol
 * as event videos. The last piece moves the file to uploads/site/ and answers with its address on the website.
 */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || !can(u.role, 'site.manage')) return err('Sign in again', 401);
  const h = (k: string) => req.headers.get(k) ?? '';
  const uploadId = h('x-upload-id');
  const index = parseInt(h('x-chunk-index'), 10), count = parseInt(h('x-chunk-count'), 10), total = parseInt(h('x-file-size'), 10);
  const mime = h('x-file-type') || 'application/octet-stream';
  const name = decodeURIComponent(h('x-file-name') || 'file');
  const want = h('x-want') === 'video' ? 'video' : 'photo';
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return err('Bad upload');
  if (!(index >= 0 && count >= 1 && index < count && total > 0)) return err('Bad piece');
  if (total > MAX_UPLOAD_BYTES) return err(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  if (want === 'video' ? !/^video\//.test(mime) : !/^image\//.test(mime)) return err(want === 'video' ? 'Choose a video file (MP4, MOV…)' : 'Choose a photo (JPG, PNG, WebP)');

  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > CHUNK_MAX) return err('Bad piece size');
  const tmp = uploadPath(`tmp/${uploadId}.part`);
  await fs.promises.mkdir(path.dirname(tmp), { recursive: true });
  const offset = parseInt(h('x-offset'), 10);
  if (!(offset >= 0)) return err('Bad piece');
  if (index === 0 && offset === 0) await fs.promises.unlink(tmp).catch(() => {});
  const have = await fs.promises.stat(tmp).then((st) => st.size).catch(() => 0);
  if (have === offset) await fs.promises.appendFile(tmp, body);
  else if (have !== offset + body.length) return NextResponse.json({ error: 'resume', have }, { status: 409 });
  if (index < count - 1) return NextResponse.json({ ok: true, received: index + 1 });

  const size = (await fs.promises.stat(tmp)).size;
  if (size !== total) { await fs.promises.unlink(tmp).catch(() => {}); return err('The file arrived incomplete, please try again', 409); }
  const ext = extFor(mime, name).replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  const file = `${randomUUID()}.${ext}`;
  await fs.promises.mkdir(path.dirname(uploadPath(`site/${file}`)), { recursive: true });
  await fs.promises.rename(tmp, uploadPath(`site/${file}`));
  return NextResponse.json({ ok: true, done: true, url: `/api/media/site/${file}` });
}
