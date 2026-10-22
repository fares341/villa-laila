import { NextRequest, NextResponse } from 'next/server';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let payloadText = '';
    let payloadJson: any = null;

    if (contentType.includes('application/json')) {
      payloadJson = await req.json();
      payloadText = JSON.stringify(payloadJson);
    } else {
      payloadText = await req.text();
    }

    // Log the sync event to audit_log
    await q(
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      ['siteminder_push', 'reservation.sync', 'reservation', 'sm_webhook', JSON.stringify({ contentType, payloadText: payloadText.slice(0, 4000) })]
    );

    // This receiver does not create reservations itself, so a person must see every notification:
    // it lands in Today's "Alerts & follow-ups" with the start of the message.
    const ref = /ResID_Value="([^"]+)"/.exec(payloadText)?.[1] ?? payloadJson?.reservation?.id ?? payloadJson?.id ?? null;
    await q(`INSERT INTO tasks(title, detail, kind, dedupe_key) VALUES($1, $2, 'channel', $3) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`Channel booking to enter${ref ? ` (${ref})` : ''}`, `A booking notification arrived from Little Hotelier / SiteMinder. Check it in Little Hotelier and enter it under Reservations if it is not there. ${payloadText.slice(0, 600)}`, ref ? `sm:${ref}` : `sm:${Date.now()}`]).catch(() => {});

    // If OTA XML response is needed
    if (contentType.includes('xml')) {
      const otaRes = `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelResNotifRS xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.000">
  <Success/>
</OTA_HotelResNotifRS>`;
      return new NextResponse(otaRes, {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' }
      });
    }

    return NextResponse.json({ success: true, message: 'Reservation notification received.' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'online',
    service: 'Villa Layla PMS - SiteMinder / Little Hotelier Reservation Receiver',
    propertyUuid: '32b4a7fc-2f73-4f63-a3d1-1c51584392bf'
  });
}
