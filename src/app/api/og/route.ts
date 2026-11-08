import { renderOg } from '@/lib/og-render';

export const dynamic = 'force-dynamic';

/** Old preview-picture address (kept for links already shared); new links use /og/<id>.jpg. */
export async function GET(req: Request) {
  return renderOg(new URL(req.url).searchParams.get('src') ?? '', req.url);
}
