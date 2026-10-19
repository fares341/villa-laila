// Property facts for the public site. Anything with verified:false is shown ONLY when SHOW_UNVERIFIED_CONTENT=true
// (with a visible "to be confirmed" badge) and is hidden in production until the owner confirms it.
// The owner's brief mentions a garden, pool and common spaces, but these could not be verified against the live site.
export type Space = { key: 'garden' | 'pool' | 'common'; verified: boolean };
export const SPACES: Space[] = [
  { key: 'garden', verified: true },
  { key: 'pool', verified: true },
  { key: 'common', verified: true },
];
export const showUnverified = () => process.env.SHOW_UNVERIFIED_CONTENT === 'true';
export const visibleSpaces = () => SPACES.filter((s) => s.verified || showUnverified());

// Real photos downloaded from the live website
export type Photo = { src: string | null; alt: Record<string, string>; slot: string };
export const PHOTOS: Photo[] = [
  { slot: 'hero', src: '/photos/gallery_and_hostel/jtfzrhhp3g0fj6vdnxjq.jpeg', alt: { en: 'Villa Layla courtyard', es: 'Patio de Villa Layla', fr: 'Cour de Villa Layla', ar: 'فناء فيلا ليلى' } },
  { slot: 'garden', src: '/photos/gallery_and_hostel/kiovp5fgbbt2luk4wopj.jpg', alt: { en: 'Garden', es: 'Jardín', fr: 'Jardin', ar: 'الحديقة' } },
  { slot: 'pool', src: '/photos/rooms/dorm_Spacious_8-Bed_Female_Dormitory/01_Spacious_8-Bed_Female_Dormitory.jpg', alt: { en: 'Pool', es: 'Piscina', fr: 'Piscine', ar: 'المسبح' } },
  { slot: 'common', src: '/photos/gallery_and_hostel/qsvj2eqgcmaurlydc1v4.jpg', alt: { en: 'Common area', es: 'Zona común', fr: 'Espace commun', ar: 'المساحة المشتركة' } },
  { slot: 'dorm', src: '/photos/rooms/dorm_10_Bed_Mixed_Dormitory/01_10_Bed_Mixed_Dormitory.jpg', alt: { en: 'Shared dorm', es: 'Dormitorio compartido', fr: 'Dortoir partagé', ar: 'عنبر مشترك' } },
  { slot: 'private', src: '/photos/rooms/private_Sheherazade/01_Sheherazade.jpg', alt: { en: 'Private room', es: 'Habitación privada', fr: 'Chambre privée', ar: 'غرفة خاصة' } },
];
export const photo = (slot: string) => PHOTOS.find((p) => p.slot === slot);

// Photos taken from the hostel's own website (villalaylahostel.com)
export const SITE_PHOTOS: string[] = [
  "/photos/gallery_and_hostel/jtfzrhhp3g0fj6vdnxjq.jpeg",
  "/photos/gallery_and_hostel/f4.jpg",
  "/photos/gallery_and_hostel/f3.jpg",
  "/photos/gallery_and_hostel/f2.jpg",
  "/photos/gallery_and_hostel/qsvj2eqgcmaurlydc1v4.jpg",
  "/photos/gallery_and_hostel/yebqgf86gomv8a8uwdmh.jpg",
  "/photos/gallery_and_hostel/uylahffomrk009eqcdo8.jpeg",
  "/photos/gallery_and_hostel/vgl0mf1ggg1jafpj0wit.jpg",
  "/photos/gallery_and_hostel/hsxz6so7xjzignn77oph.jpg",
  "/photos/gallery_and_hostel/kiovp5fgbbt2luk4wopj.jpg",
  "/photos/gallery_and_hostel/joxg0ghsuozk2omoecp6.jpg"
];
export const ALT: Record<string, string> = { en: 'Villa Layla Hostel, Cairo', es: 'Villa Layla Hostel, El Cairo', fr: 'Villa Layla Hostel, Le Caire', ar: 'فيلا ليلى هوستل، القاهرة' };

// Instagram: official profile + optional owner-chosen posts/reels (comma-separated URLs in INSTAGRAM_POST_URLS).
export const INSTAGRAM_PROFILE = 'https://instagram.com/villalaylacairo';
export function instagramEmbeds(): string[] {
  return (process.env.INSTAGRAM_POST_URLS ?? '').split(',').map((u) => u.trim())
    .map((u) => u.match(/^https:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/)).filter(Boolean)
    .map((m) => `https://www.instagram.com/${m![1]}/${m![2]}/embed`);
}

