import React from 'react';

/** WhatsApp's speech-bubble mark (white), for the green WhatsApp buttons and badges. */
export const WaMark = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden fill="currentColor">
    <path d="M16.04 3C8.86 3 3.03 8.82 3.03 15.99c0 2.3.6 4.53 1.74 6.5L3 29l6.68-1.75a12.97 12.97 0 0 0 6.36 1.62h.01c7.17 0 13-5.83 13-13S23.21 3 16.04 3zm0 23.68h-.01a10.76 10.76 0 0 1-5.48-1.5l-.39-.23-3.97 1.04 1.06-3.87-.26-.4a10.7 10.7 0 0 1-1.65-5.73c0-5.94 4.84-10.77 10.8-10.77 2.88 0 5.59 1.12 7.62 3.16a10.7 10.7 0 0 1 3.16 7.62c0 5.95-4.84 10.78-10.78 10.78zm5.91-8.07c-.32-.16-1.92-.95-2.22-1.06-.3-.11-.51-.16-.73.16-.21.32-.84 1.06-1.03 1.27-.19.22-.38.24-.7.08-.32-.16-1.36-.5-2.6-1.6-.96-.85-1.6-1.91-1.8-2.23-.19-.32-.02-.5.14-.66.15-.14.32-.38.48-.57.16-.19.21-.32.32-.54.11-.21.05-.4-.03-.56-.08-.16-.73-1.75-1-2.4-.26-.63-.53-.54-.73-.55h-.62c-.21 0-.56.08-.86.4-.3.32-1.13 1.1-1.13 2.69 0 1.58 1.16 3.11 1.32 3.33.16.21 2.28 3.48 5.52 4.88.77.33 1.37.53 1.84.68.77.25 1.48.21 2.03.13.62-.09 1.92-.78 2.19-1.54.27-.76.27-1.41.19-1.54-.08-.14-.29-.22-.61-.38z" />
  </svg>
);

const T = {
  community: { en: ['Villa Layla community', 'Be the first to hear about new events, pool days and dinners.', 'Join on WhatsApp'], ar: ['مجتمع فيلا ليلى', 'اعرف أول بأول بالإيفنتات الجديدة وأيام البيسين والعشا.', 'انضم على واتساب'] },
  event: { en: ['The event’s WhatsApp group', 'Updates, reminders and photos from the night, with everyone who’s coming.', 'Join the group'], ar: ['جروب واتساب الإيفنت', 'التحديثات والتذكير وصور الليلة، مع كل اللي جايين.', 'ادخل الجروب'] },
};

/**
 * A WhatsApp group / community invite. `head`: the small card next to the «Events» heading. `side`: the card in an
 * event page's side column (the event's own group, or the villa's community when it has none).
 */
export function WaGroup({ href, lang, kind = 'community', variant = 'side' }: { href: string; lang: string; kind?: 'community' | 'event'; variant?: 'head' | 'side' }) {
  const [title, text, cta] = T[kind][lang === 'ar' ? 'ar' : 'en'];
  return (
    <a className={`wag wag-${variant}`} href={href} target="_blank" rel="noopener noreferrer">
      <span className="wag-ic"><WaMark size={variant === 'head' ? 24 : 26} /></span>
      <span className="wag-txt">
        <b>{title}</b>
        <small>{text}</small>
      </span>
      <span className="wag-cta">{cta}<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
    </a>
  );
}
