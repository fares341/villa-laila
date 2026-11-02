import { optOut } from '@/services/collabs';

export const dynamic = 'force-dynamic';

/** "No more invitations" link from an invitation e-mail. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ok = await optOut(u.searchParams.get('e') || '', u.searchParams.get('t') || '').catch(() => false);
  const body = ok
    ? '<h1>Done</h1><p>You will not get more invitations from Villa Layla.</p><p dir="rtl">تمام، مش هيوصلك دعوات تانية من فيلا ليلى.</p>'
    : '<h1>Link not valid</h1><p>Message us on WhatsApp +20 104 055 1515 and we will take you off the list.</p>';
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Villa Layla</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#2F2925;text-align:center">${body}</body>`, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
