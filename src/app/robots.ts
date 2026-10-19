export default function robots() {
  const base = process.env.PUBLIC_BASE_URL ?? '';
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/dashboard', '/api'] }], sitemap: base ? `${base}/sitemap.xml` : undefined };
}
