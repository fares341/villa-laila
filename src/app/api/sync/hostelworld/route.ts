import { NextRequest, NextResponse } from 'next/server';
import { syncHostelworldData, readCachedRates, getDefaultRates } from '@/services/hostelworld-sync';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const dateStart = searchParams.get('dateStart') || undefined;
  const nights = searchParams.get('nights') ? parseInt(searchParams.get('nights')!, 10) : 1;
  const currency = searchParams.get('currency') || 'USD';
  const force = searchParams.get('force') === 'true' || searchParams.get('refresh') === '1';

  try {
    const data = await syncHostelworldData({ dateStart, nights, currency, force });
    return NextResponse.json(data);
  } catch (err: any) {
    const fallback = readCachedRates() || getDefaultRates();
    return NextResponse.json({ ...fallback, warning: err.message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dateStart = body.dateStart || undefined;
    const nights = body.nights ? parseInt(body.nights, 10) : 1;
    const currency = body.currency || 'USD';

    const data = await syncHostelworldData({ dateStart, nights, currency, force: true });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
