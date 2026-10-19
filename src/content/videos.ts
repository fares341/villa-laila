// Guest videos (reels) shown on the homepage. Managed in Dashboard → Settings → Guest videos (setting key "guest_videos").
// Supported links: Instagram reel/post, TikTok video, YouTube Shorts/video, or a direct .mp4 file URL.
export type VideoEmbed = { kind: 'iframe' | 'mp4'; src: string; source: string };

export function toEmbed(raw: string): VideoEmbed | null {
  const u = raw.trim();
  if (!/^https:\/\//.test(u)) return null;
  let m = u.match(/^https:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  if (m) return { kind: 'iframe', src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed`, source: u };
  m = u.match(/^https:\/\/(?:www\.)?tiktok\.com\/@[\w.]+\/video\/(\d+)/);
  if (m) return { kind: 'iframe', src: `https://www.tiktok.com/embed/v2/${m[1]}`, source: u };
  m = u.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}`, source: u };
  if (/\.mp4(\?|$)/i.test(u)) return { kind: 'mp4', src: u, source: u };
  return null;
}
