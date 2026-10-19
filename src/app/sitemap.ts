export default function sitemap() {
  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const paths = ['', '/rooms', '/gallery', '/location', '/faq', '/policies', '/book'];
  return ['en', 'es', 'fr', 'ar'].flatMap((l) => paths.map((p) => ({ url: `${base}/${l}${p}`, alternates: { languages: Object.fromEntries(['en', 'es', 'fr', 'ar'].map((x) => [x, `${base}/${x}${p}`])) } })));
}
