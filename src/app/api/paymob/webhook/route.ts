import { verifyProcessedHmac, txnFromProcessed } from '@/services/paymob';
import { applyPaymobTxn } from '@/services/online-payments';

export const dynamic = 'force-dynamic';

// Paymob "transaction processed" callback (server to server). Sent to the notification_url of each intention.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const hmac = url.searchParams.get('hmac') || '';
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const obj = body?.obj;
  if (body?.type && body.type !== 'TRANSACTION') return Response.json({ ok: true, ignored: body.type });
  if (!verifyProcessedHmac(obj, hmac)) {
    console.warn('[paymob webhook] bad hmac');
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const op = await applyPaymobTxn(txnFromProcessed(obj), { source: 'webhook', obj });
    // A room booking just paid: tell reception it is waiting for their confirmation (once, on the first "paid").
    if (op?.status === 'paid' && op.kind === 'room' && op.reservation_id && op.justPaid) {
      import('@/services/admin-bot').then((m) => m.notifyRoomPaid(op.reservation_id, Number(op.amount_cents))).catch((e) => console.error('[admin bot paid]', e));
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[paymob webhook]', e);
    return Response.json({ ok: false }, { status: 500 }); // Paymob retries
  }
}
