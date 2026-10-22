import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { addEventMedia, deleteEventMedia, setMediaOrientation } from '@/services/event-content';
import { BookingError } from '@/services/errors';

export const dynamic = 'force-dynamic';

/**
 * Meal photos and videos from the event edit page. A plain route (not a server action) so a video of up to 50 MB
 * is not stopped by the server-action body limit.
 */
const kind_orientation = (fd: FormData) => { const o = String(fd.get('orientation') || ''); return o === 'portrait' || o === 'landscape' ? o : undefined; };

export async function POST(req: Request) {
  const u = await requireUser('events.manage');
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return new NextResponse('Forbidden', { status: 403 });
  const fd = await req.formData();
  const eventId = String(fd.get('eventId') || '');
  const back = (k: 'ok' | 'err', m: string) => NextResponse.redirect(new URL(`/dashboard/events/edit/${eventId}?${k}=${encodeURIComponent(m)}#media`, req.url), 303);
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return new NextResponse('Bad request', { status: 400 });
  try {
    const del = String(fd.get('delete') || '');
    if (del) { await deleteEventMedia(del, u.email); return back('ok', 'Removed from the website'); }
    const shapeOf = String(fd.get('shapeOf') || '');
    if (shapeOf) { await setMediaOrientation(shapeOf, String(fd.get('orientation')) === 'portrait' ? 'portrait' : 'landscape'); return back('ok', 'Video shape changed'); }
    const orientation = kind_orientation(fd);
    const kind = String(fd.get('kind')) === 'video' ? 'video' : 'meal';
    const files = fd.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0);
    const url = String(fd.get('url') || '').trim();
    let n = 0;
    for (const f of files) { await addEventMedia(eventId, kind, { bytes: Buffer.from(await f.arrayBuffer()), mime: f.type || 'application/octet-stream' }, null, u.email, null, orientation); n++; }
    if (url) { await addEventMedia(eventId, kind, null, url, u.email, null, orientation); n++; }
    if (!n) return back('err', kind === 'video' ? 'Choose a video or paste a link' : 'Choose at least one photo');
    return back('ok', `${n} ${kind === 'video' ? 'video(s)' : 'photo(s)'} added and shown on the event page`);
  } catch (e) {
    return back('err', e instanceof BookingError ? (e.message || e.code) : 'Upload failed');
  }
}
