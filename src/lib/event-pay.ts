/**
 * Who may pay how on the website (owner, Oct 2026):
 *  - Only a hostel guest (staying at the villa) may pay at the villa (cash); they may also use InstaPay.
 *  - Everyone else pays by InstaPay only (they book, go to the villa's WhatsApp, and reception sends the number).
 * If InstaPay is switched off, outside guests fall back to the event's other online methods (never cash), so the
 * event stays bookable.
 */
export type EventPayMethod = 'paymob' | 'instapay' | 'vodafone_cash' | 'cash';

export function methodsFor(live: readonly EventPayMethod[], isHotelGuest: boolean): EventPayMethod[] {
  if (isHotelGuest) return live.includes('instapay') ? ['cash', 'instapay'] : ['cash'];
  if (live.includes('instapay')) return ['instapay'];
  return live.filter((m) => m !== 'cash');
}
