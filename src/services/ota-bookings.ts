import { q, tx } from '@/lib/db';
import { BookingError } from './errors';
import { audit } from './audit';
import { createReservation } from './reservations';
import { rateFor, toEgp, type Currency } from './pms/fx';
import { nightsBetween, todayLocal } from '@/lib/dates';

/**
 * Bookings from the booking sites, typed in by reception (no channel manager). Each site has its own section.
 *
 *  - Booking.com:  guest pays at the hostel (or, if the booking says so, Booking.com already took the money)
 *  - Airbnb:       Airbnb always takes the money and pays the hostel later
 *  - Hostelworld:  the guest paid a deposit to Hostelworld; the rest is paid at the hostel
 *  - Expedia Collect: Expedia took the money and pays the hostel
 *  - Expedia Hotel Collect: the guest pays at the hostel
 *
 * Money already paid to the site goes on the folio as "channel_prepaid" (not in any drawer). The rest is the
 * balance, collected at check-in / check-out through the POS like any other guest.
 */
export type ChannelKey = 'booking_com' | 'airbnb' | 'hostelworld' | 'expedia_collect' | 'expedia_hotel' | 'agoda' | 'website' | 'walk_in';
export const SITE_KEYS = ['booking_com', 'airbnb', 'hostelworld', 'expedia_collect', 'expedia_hotel', 'agoda'] as const;
export const CHANNELS: Record<ChannelKey, { label: string; source: 'booking_com' | 'airbnb' | 'hostelworld' | 'expedia' | 'agoda' | 'website' | 'walk_in'; collect: 'property' | 'channel' | 'deposit'; canPrepay?: boolean; canPayAtHostel?: boolean; direct?: boolean; help: string }> = {
  booking_com: { label: 'Booking.com', source: 'booking_com', collect: 'property', canPrepay: true, help: 'The guest pays at the hostel. Tick "Paid via Booking.com" only if the booking shows Booking.com already charged the guest.' },
  airbnb: { label: 'Airbnb', source: 'airbnb', collect: 'channel', help: 'Airbnb already took the money and pays the hostel. Nothing to collect at the desk, except extras.' },
  hostelworld: { label: 'Hostelworld', source: 'hostelworld', collect: 'deposit', help: 'The guest paid a deposit to Hostelworld. The rest of the total is paid at the hostel.' },
  expedia_collect: { label: 'Expedia (paid to Expedia)', source: 'expedia', collect: 'channel', help: 'Expedia charged the guest and pays the hostel. Nothing to collect at the desk, except extras.' },
  expedia_hotel: { label: 'Expedia (pays here)', source: 'expedia', collect: 'property', help: 'The guest pays the full amount at the hostel.' },
  agoda: { label: 'Agoda', source: 'agoda', collect: 'channel', canPayAtHostel: true, help: 'Agoda usually charges the guest and pays the hostel. Tick "Guest pays at the hostel" only if the booking says Pay at the hotel.' },
  website: { label: 'Direct & website', source: 'website', collect: 'property', direct: true, help: 'Guests who booked with us: on villalaylahostel.com (they arrive here by themselves) or by phone, WhatsApp or email (add them here). The guest pays on the POS.' },
  walk_in: { label: 'Walk-in', source: 'walk_in', collect: 'property', direct: true, help: 'The guest came to the hostel and booked at the desk. Arriving today = checked in straight away. The guest pays on the POS.' },
};
export const channelOf = (source: string, collect: string | null): ChannelKey | null =>
  source === 'expedia' ? (collect === 'channel' ? 'expedia_collect' : 'expedia_hotel') : (['booking_com', 'airbnb', 'hostelworld', 'agoda', 'website', 'walk_in'].includes(source) ? source as ChannelKey : null);

export type OtaInput = {
  channel: ChannelKey; ref: string;
  fullName: string; phone?: string | null; email?: string | null; nationality?: string | null;
  roomTypeId: string; unitIds?: string[]; checkIn: string; checkOut: string; guests: number;
  total: number | null; currency: Currency;     // total the guest pays for the stay, as shown on the booking (minor units); direct bookings may leave it empty = our rates
  prepaidByChannel?: boolean;                    // Booking.com: the site already charged the guest
  payAtHostel?: boolean;                         // Agoda: pay-at-the-hotel booking
  deposit?: number;                              // Hostelworld: deposit paid to Hostelworld (minor units, same currency)
  commission?: number | null;                    // optional, for reports (minor units, same currency)
  notes?: string | null; actor: string; userId: string | null;
};

export async function createOtaBooking(v: OtaInput) {
  const ch = CHANNELS[v.channel];
  if (!ch) throw new BookingError('INVALID_INPUT', 'Unknown booking site');
  const ref = (v.ref ?? '').trim().replace(/\s+/g, '');
  if (!ch.direct && ref.length < 4) throw new BookingError('INVALID_INPUT', `Write the ${ch.label} confirmation number`);
  if (!ch.direct && !(Number(v.total) > 0)) throw new BookingError('INVALID_INPUT', 'Write the total price of the booking');
  if (v.total != null && !(v.total > 0)) throw new BookingError('INVALID_INPUT', 'The price must be more than 0');
  if (!v.fullName?.trim()) throw new BookingError('INVALID_INPUT', 'Write the guest name');
  const nights = nightsBetween(v.checkIn, v.checkOut);
  if (!(nights >= 1)) throw new BookingError('INVALID_DATES');
  if (v.channel === 'walk_in' && v.checkIn < todayLocal()) throw new BookingError('INVALID_DATES', 'A walk-in cannot start in the past');
  if (ref) {
    const dup = (await q<any>(`SELECT reference FROM reservations WHERE source=$1 AND channel_ref=$2`, [ch.source, ref]))[0];
    if (dup) throw new BookingError('CONFLICT', `${ch.label} booking ${ref} is already entered (${dup.reference})`);
  }

  // Everything is kept in EGP; a foreign-currency price is converted at today's rate (noted on the booking).
  const rate = await rateFor(v.currency);
  const egp = (minor: number) => (v.currency === 'EGP' ? Math.round(minor) : toEgp(Math.round(minor), rate));
  const ownPrice = v.total == null;                // direct booking with no price written: our own rates
  const totalEgp = ownPrice ? 0 : egp(v.total!);
  const collect = ch.canPrepay && v.prepaidByChannel ? 'channel' : ch.canPayAtHostel && v.payAtHostel ? 'property' : ch.collect;
  const prepaidEgp = collect === 'channel' ? totalEgp : collect === 'deposit' ? egp(v.deposit ?? 0) : 0;
  if (prepaidEgp > totalEgp) throw new BookingError('INVALID_INPUT', 'The deposit is more than the total');
  if (collect === 'deposit' && !(prepaidEgp > 0)) throw new BookingError('INVALID_INPUT', 'Write the deposit the guest paid to Hostelworld');
  const commissionEgp = v.commission ? egp(v.commission) : null;
  const priceNote = ownPrice || v.currency === 'EGP' ? '' : ` (${v.currency} ${(v.total! / 100).toFixed(2)} at ${rate})`;

  const res = await createReservation({
    guest: { fullName: v.fullName, email: v.email || null, phone: v.phone || null, nationality: v.nationality || null, language: 'en' } as any,
    roomTypeId: v.roomTypeId, unitIds: v.unitIds?.length ? v.unitIds : undefined, checkIn: v.checkIn, checkOut: v.checkOut, guestsCount: v.guests,
    source: ch.source as any, status: 'confirmed', actor: v.actor, createdBy: v.userId, staffEntered: true,
    staffNotes: [ref || ch.direct ? `${ch.label}${ref ? ' ' + ref : ''}${priceNote}` : '', v.notes].filter(Boolean).join(' · '),
  });

  if (ownPrice) {
    // Price from our own rates (already on the booking).
    await q(`UPDATE reservations SET channel_collect='property', updated_at=now() WHERE id=$1`, [res.id]);
  } else await tx(async (c) => {
    // The site's price replaces our rate: spread it over the nights and units (any rounding remainder on the last night).
    const units = Number((await c.query(`SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active`, [res.id])).rows[0].n) || 1;
    const per = Math.floor(totalEgp / (nights * units));
    let rest = totalEgp - per * nights * units;             // < nights × units piastres
    const lastExtra = Math.floor(rest / units); rest -= lastExtra * units; // < units piastres left
    const lines = Array.from({ length: nights }, (_, i) => {
      const d = new Date(Date.parse(v.checkIn + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10);
      return { date: d, unitPriceCents: per + (i === nights - 1 ? lastExtra : 0), rate: ch.label };
    });
    const roomTotal = lines.reduce((a, l) => a + l.unitPriceCents, 0) * units;
    await c.query(`UPDATE reservations SET total_cents=$2, price_breakdown=$3, channel_ref=$4, channel_collect=$5, channel_commission_cents=$6, channel_prepaid_cents=$7, updated_at=now() WHERE id=$1`,
      [res.id, roomTotal, JSON.stringify(lines), ref || null, collect, commissionEgp, prepaidEgp]);
    // The last few piastres that cannot be split evenly between beds go on as one line, so the folio is exactly the booking price.
    if (rest > 0) {
      await c.query(`INSERT INTO folio_entries(reservation_id,entry_date,kind,description,quantity,unit_cents,amount_cents,currency,note)
                     VALUES($1,$2,'adjustment',$3,1,$4,$4,'EGP',$5)`, [res.id, v.checkIn, `${ch.label} price rounding`, rest, `Booking ${ref}`]);
    }
    if (prepaidEgp > 0) {
      await c.query(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,recorded_by,verified_by,verified_at)
                     VALUES($1,$2,'channel_prepaid',$3,'verified',$4,$5,$5,now())`,
        [res.id, prepaidEgp, `${ch.label} ${ref}`, collect === 'deposit' ? `Deposit paid to ${ch.label}` : `Paid to ${ch.label} (the site pays the hostel)`, v.userId]);
    }
  });
  if (ownPrice && ref) await q(`UPDATE reservations SET channel_ref=$2 WHERE id=$1`, [res.id, ref]);
  // Walk-in arriving today: checked in straight away (nights posted to the account, bed shows as in house).
  if (v.channel === 'walk_in' && v.checkIn === todayLocal()) {
    const { checkInGuest } = await import('./pms/frontdesk');
    await checkInGuest(res.id, v.actor, v.userId as any);
  }
  await audit(v.actor, 'reservation.ota_create', 'reservation', res.id, { channel: v.channel, ref, totalEgp, prepaidEgp });
  const r = (await q<any>(`SELECT total_cents FROM reservations WHERE id=$1`, [res.id]))[0];
  return { id: res.id, reference: res.reference, totalEgp: Number(r.total_cents), prepaidEgp, dueAtHostel: Number(r.total_cents) - prepaidEgp };
}

/** Bookings of one section, upcoming and in house first, then the last 30 days. */
export async function listOta(channel: ChannelKey) {
  const ch = CHANNELS[channel];
  const collectFilter = ch.source === 'expedia' ? (channel === 'expedia_collect' ? `AND r.channel_collect='channel'` : `AND COALESCE(r.channel_collect,'property')<>'channel'`) : '';
  return q<any>(`
    SELECT r.id, r.reference, r.channel_ref, r.status, r.check_in, r.check_out, r.guests_count, r.channel_collect, r.channel_prepaid_cents, r.channel_commission_cents,
      folio_charges(r.id)::bigint charges, g.full_name, g.nationality, t.name tname,
      (SELECT string_agg(x.room || COALESCE(': ' || x.beds, ''), ' · ' ORDER BY x.room) FROM (
         SELECT rm.name room, CASE WHEN tt.kind='dorm' THEN string_agg(u.label, ', ' ORDER BY length(u.label), u.label) END beds
         FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types tt ON tt.id=rm.room_type_id
         WHERE ru.reservation_id=r.id AND ru.active GROUP BY rm.name, tt.kind) x) beds,
      COALESCE((SELECT sum(amount_cents) FROM payments p WHERE p.reservation_id=r.id AND p.status='verified'),0)::bigint paid
    FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id
    WHERE r.source=$1 ${collectFilter} AND r.check_out >= current_date - 30
    ORDER BY (r.status IN ('pending','confirmed','checked_in') AND r.check_out >= current_date) DESC, r.check_in, r.created_at DESC LIMIT 200`, [ch.source]);
}

export async function otaCounts(): Promise<Record<ChannelKey, number>> {
  const rows = await q<any>(`SELECT source, channel_collect, count(*)::int n FROM reservations WHERE source IN ('booking_com','airbnb','hostelworld','expedia','agoda','website','walk_in') AND status IN ('pending','confirmed','checked_in') AND check_out >= current_date GROUP BY 1,2`);
  const out: any = { booking_com: 0, airbnb: 0, hostelworld: 0, expedia_collect: 0, expedia_hotel: 0, agoda: 0, website: 0, walk_in: 0 };
  for (const r of rows) { const k = channelOf(r.source, r.channel_collect); if (k) out[k] += r.n; }
  return out;
}
