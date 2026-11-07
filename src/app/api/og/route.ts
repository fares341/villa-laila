import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { q } from '@/lib/db';
import { uploadPath } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

/** The bytes of a photo of this site, from its public address (only our own photo addresses are read). */
async function load(src: string): Promise<Buffer | null> {
  const clean = src.split('?')[0];
  let m: RegExpExecArray | null;
  try {
    if ((m = /^\/api\/media\/site\/([0-9a-f-]{36}\.[a-z0-9]{2,5})$/i.exec(clean))) return await fs.promises.readFile(uploadPath(`site/${m[1].toLowerCase()}`));
    if ((m = /^\/api\/media\/event\/([0-9a-f-]{36})$/i.exec(clean))) return (await q<any>(`SELECT image_bytes FROM events WHERE id=$1`, [m[1]]))[0]?.image_bytes ?? null;
    if ((m = /^\/api\/media\/event-media\/([0-9a-f-]{36})$/i.exec(clean))) {
      const r = (await q<any>(`SELECT file_path, bytes, mime FROM event_media WHERE id=$1`, [m[1]]))[0];
      if (!r || !/^image\//.test(r.mime || '')) return null;
      return r.file_path ? await fs.promises.readFile(uploadPath(r.file_path)) : r.bytes ?? null;
    }
    if (/^\/(photos|images|brand)\/[\w./-]+\.(jpe?g|png|webp|avif)$/i.test(clean) && !clean.includes('..')) return await fs.promises.readFile(path.join(process.cwd(), 'public', clean));
  } catch { /* missing file */ }
  return null;
}

/**
 * Link-preview picture: the photo at ?src= cropped to 1200×630 and saved as a light JPEG (about 100–200 KB), which
 * WhatsApp, Facebook and others show. Made once and kept in the uploads folder.
 */
export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get('src') ?? '';
  const bytes = await load(src);
  if (!bytes) return new Response('Not found', { status: 404 });
  const key = createHash('sha1').update(src).update(String(bytes.length)).update(bytes.subarray(0, 4096)).digest('hex').slice(0, 24);
  const file = uploadPath(`og/${key}.jpg`);
  const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' };
  try { return new Response(new Uint8Array(await fs.promises.readFile(file)), { headers }); } catch { /* not made yet */ }
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(bytes, { failOn: 'none' }).rotate().resize(1200, 630, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await fs.promises.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
    await fs.promises.writeFile(file, out).catch(() => {});
    return new Response(new Uint8Array(out), { headers });
  } catch {
    // No image tool here: send the photo as it is (better than nothing).
    return Response.redirect(new URL(src, req.url), 302);
  }
}
