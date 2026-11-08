import type { MetadataRoute } from 'next';

const AI_BOTS = [
  'GPTBot',
  'ChatGPT-User',
  'Claude-Web',
  'ClaudeBot',
  'anthropic-ai',
  'CCBot',
  'Bytespider',
  'Diffbot',
  'FacebookBot',
  'Google-Extended',
  'PerplexityBot',
  'Amazonbot',
  'ImagesiftBot',
];

export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_BASE_URL ?? 'https://villalaylahostel.com';
  return {
    rules: [
      {
        userAgent: '*',
        // Link previews (WhatsApp, Facebook, X…) must be able to fetch the page pictures: /og/ and /api/media/.
        allow: ['/', '/og/', '/api/og', '/api/media/'],
        disallow: ['/dashboard', '/pos', '/api', '/print'],
      },
      ...AI_BOTS.map((bot) => ({
        userAgent: bot,
        disallow: ['/'],
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

