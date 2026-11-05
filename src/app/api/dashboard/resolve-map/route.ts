import { requireUser } from '@/lib/auth';
import { resolveMapUrl } from '@/services/maps';

export const dynamic = 'force-dynamic';

/** Dashboard map picker: a pasted Google Maps link (short ones too) → its full link, pin and place name. */
export async function GET(req: Request) {
  await requireUser('events.manage');
  const url = new URL(req.url).searchParams.get('url') ?? '';
  const p = await resolveMapUrl(url);
  return Response.json(p ?? { url, lat: null, lng: null, name: null }, { headers: { 'cache-control': 'no-store' } });
}
