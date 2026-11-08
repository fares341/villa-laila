import { renderOg } from '@/lib/og-render';

export const dynamic = 'force-dynamic';

/**
 * Link-preview picture at a plain image address (/og/<id>.jpg), outside /api: robots.txt keeps crawlers out of /api,
 * and WhatsApp / Facebook's crawler obeys it, so a picture under /api/og was never fetched for the preview.
 * <id> is the page photo's own address, base64url-encoded.
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = file.replace(/\.jpe?g$/i, '');
  let src = '';
  try { src = Buffer.from(id, 'base64url').toString('utf8'); } catch { /* bad id */ }
  if (!src.startsWith('/')) return new Response('Not found', { status: 404 });
  return renderOg(src, req.url);
}
