import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { addEventMedia, deleteEventMedia, setMediaOrientation } from '@/services/event-content';
import { BookingError } from '@/services/errors';

export const dynamic = 'force-dynamic';

/** Remove a photo / video, change a video's shape, or add a video link (JSON, used by the media box). */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || !can(u.role, 'events.manage')) return NextResponse.json({ error: 'Sign in again' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.op === 'delete') await deleteEventMedia(String(b.id), u.email);
    else if (b.op === 'shape') await setMediaOrientation(String(b.id), b.orientation === 'portrait' ? 'portrait' : 'landscape');
    else if (b.op === 'link') await addEventMedia(String(b.eventId), 'video', null, String(b.url || '').trim(), u.email, null, b.orientation === 'portrait' ? 'portrait' : b.orientation === 'landscape' ? 'landscape' : undefined);
    else return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof BookingError ? e.message || e.code : 'Failed' }, { status: 400 });
  }
}
