import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/base-url';
import { addRsvp, emailCollabRsvp } from '@/services/collabs';
import { siteBase } from '@/lib/base-url';
import { BookingError } from '@/services/errors';

export const dynamic = 'force-dynamic';

/** Sign-up from a collab event page: name, phone, how many people (and e-mail / Instagram / note). */
export async function POST(req: NextRequest) {
  const ip = await clientIp();
  if (!rateLimit('collab:' + ip, 10, 10 * 60_000)) return NextResponse.json({ ok: false, error: 'rate_limit' }, { status: 429 });
  const b = await req.json().catch(() => ({} as any));
  if (b.website) return NextResponse.json({ ok: true }); // honeypot
  try {
    const { rsvp, collab, updated } = await addRsvp({
      slug: String(b.slug || ''), fullName: String(b.fullName || ''), phone: String(b.phone || ''), email: b.email ? String(b.email) : null,
      people: Number(b.people || 1), instagram: b.instagram ? String(b.instagram) : null, note: b.note ? String(b.note) : null,
    });
    siteBase().catch(() => '').then((base) => emailCollabRsvp(rsvp, collab, updated, base)).catch((e) => console.error('[collab mail]', e));
    import('@/services/admin-bot').then((m) => m.notifyCollabRsvp(rsvp, collab, updated)).catch((e) => console.error('[collab notify]', e));
    return NextResponse.json({ ok: true, updated, people: rsvp.people });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ ok: false, error: `${e.code.toLowerCase()}${e.message && e.message !== e.code ? ':' + e.message : ''}` }, { status: 400 });
    console.error('[collab rsvp]', e);
    return NextResponse.json({ ok: false, error: 'generic' }, { status: 500 });
  }
}
