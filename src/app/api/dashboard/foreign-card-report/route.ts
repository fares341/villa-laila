import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { cardPayersXlsx } from '@/services/pms/card-payers';

export const dynamic = 'force-dynamic';

/** Excel of foreign guests who paid by card on a given day (managers only: it holds passport numbers). */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || !can(u.role, 'reports.view')) return new Response('Forbidden', { status: 403 });
  const day = new URL(req.url).searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response('Pick a date', { status: 400 });
  const { file, name } = await cardPayersXlsx(day);
  return new Response(new Uint8Array(file), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
}
