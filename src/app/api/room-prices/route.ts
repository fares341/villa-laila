import { NextRequest, NextResponse } from 'next/server';
import { homeRoomPrices } from '@/services/direct-book';
import { isIsoDate, todayLocal, addDays } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/** Room prices for the home page cards for one night: from the booking engine, Hostelworld where it has none. */
export async function GET(req: NextRequest) {
  const d = req.nextUrl.searchParams.get('date') || '';
  const date = isIsoDate(d) && d >= todayLocal() ? d : addDays(todayLocal(), 1);
  return NextResponse.json({ date, rooms: await homeRoomPrices(date) });
}
