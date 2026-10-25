import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { BookingError } from '@/services/errors';
import { saveTour, setTourImage, addFilm, setFilmPoster, setActive, move, remove, editRoomPhotos } from '@/services/site-content';

export const dynamic = 'force-dynamic';

const ID = /^[0-9a-f-]{36}$/i;

/** Website management actions (JSON): trips, films, room photos. Owner and managers. */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || !can(u.role, 'site.manage')) return NextResponse.json({ error: 'Sign in again' }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const id = typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
  try {
    let out: unknown = null;
    switch (b.op) {
      case 'tour.save': out = await saveTour(id, b.fields ?? {}, u.email); break;
      case 'tour.image': if (!id) throw new BookingError('INVALID_INPUT', 'id'); await setTourImage(id, b.url, u.email); break;
      case 'film.add': out = await addFilm(b.kind === 'main' ? 'main' : 'reel', b.video, b.poster ?? null, u.email); break;
      case 'film.poster': if (!id) throw new BookingError('INVALID_INPUT', 'id'); await setFilmPoster(id, b.url, u.email); break;
      case 'show': case 'hide': if (!id) throw new BookingError('INVALID_INPUT', 'id'); await setActive(b.what, id, b.op === 'show', u.email); break;
      case 'up': case 'down': if (!id) throw new BookingError('INVALID_INPUT', 'id'); await move(b.what, id, b.op === 'up' ? -1 : 1, u.email); break;
      case 'delete': if (!id) throw new BookingError('INVALID_INPUT', 'id'); await remove(b.what, id, u.email); break;
      case 'room.photos': if (!id) throw new BookingError('INVALID_INPUT', 'id'); out = await editRoomPhotos(id, b.edit ?? {}, u.email); break;
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    for (const l of ['en', 'ar', 'fr', 'es']) revalidatePath(`/${l}`);
    return NextResponse.json({ ok: true, out });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message || e.code }, { status: 400 });
    console.error('[site]', e);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
