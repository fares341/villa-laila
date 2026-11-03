import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp, siteBase } from '@/lib/base-url';
import { addApplication, notifyApplication } from '@/services/applications';
import { BookingError } from '@/services/errors';

export const dynamic = 'force-dynamic';

/** "Join the team" form: a job or volunteer application. */
export async function POST(req: NextRequest) {
  const ip = await clientIp();
  if (!rateLimit('join:' + ip, 5, 30 * 60_000)) return NextResponse.json({ ok: false, error: 'rate_limit' }, { status: 429 });
  const b = await req.json().catch(() => ({} as any));
  if (b.website) return NextResponse.json({ ok: true }); // honeypot
  try {
    const row = await addApplication({
      kind: String(b.kind || ''), fullName: String(b.fullName || ''), birthDate: String(b.birthDate || ''), phone: String(b.phone || ''), email: String(b.email || ''),
      languages: String(b.languages || ''), experience: String(b.experience || ''), why: String(b.why || ''),
      availability: Array.isArray(b.availability) ? b.availability.map(String) : [], rotatingShifts: String(b.rotatingShifts || ''),
      startWhen: String(b.startWhen || ''), stayLength: String(b.stayLength || ''), note: String(b.note || ''), lang: String(b.lang || ''),
    });
    siteBase().catch(() => '').then((base) => notifyApplication(row, base)).catch((e) => console.error('[join notify]', e));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ ok: false, error: `${e.code.toLowerCase()}${e.message && e.message !== e.code ? ':' + e.message : ''}` }, { status: 400 });
    console.error('[join]', e);
    return NextResponse.json({ ok: false, error: 'generic' }, { status: 500 });
  }
}
