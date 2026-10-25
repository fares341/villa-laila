import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { pool } from '@/lib/db';
import { quote } from '@/services/pricing';
import { getSetting } from '@/services/settings';

export const dynamic = 'force-dynamic';

/** Our price right now for a room type, dates and number of beds/rooms — shown live while reception types a booking. */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || !can(u.role, 'reservation.view')) return NextResponse.json({ error: 'Sign in again' }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const type = p.get('type') ?? '', ci = p.get('in') ?? '', co = p.get('out') ?? '';
  const units = Math.max(1, Math.min(40, Number(p.get('units')) || 1));
  if (!/^[0-9a-f-]{36}$/i.test(type) || !/^\d{4}-\d{2}-\d{2}$/.test(ci) || !/^\d{4}-\d{2}-\d{2}$/.test(co) || co <= ci) return NextResponse.json({ error: 'bad input' }, { status: 400 });
  try {
    const qt = await quote(pool() as any, type, ci, co, units);
    const currency = (await getSetting<string>('currency').catch(() => null)) ?? 'EGP';
    return NextResponse.json({ ok: true, currency, ...qt });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'No price for these dates' });
  }
}
