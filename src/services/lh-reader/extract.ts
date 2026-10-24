/**
 * Finds bookings inside the JSON that Little Hotelier's own web app loads (read-only). Little Hotelier has no
 * public API, so instead of fixed field names this looks for objects that clearly are bookings: an arrival and a
 * departure date plus a booking number or guest. Discovery mode saves samples so the mapping can be checked.
 */
export type LhBooking = {
  key: string; ref: string; channel: string; status: string; cancelled: boolean;
  guest: string; email: string | null; phone: string | null; nationality: string | null;
  checkIn: string; checkOut: string; guests: number; roomType: string | null;
  total: number | null; currency: string | null; paymentNote: string | null; raw: Record<string, unknown>;
};

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const ARR = ['checkin', 'checkindate', 'arrival', 'arrivaldate', 'arrivalon', 'startdate', 'datefrom', 'fromdate'];
const DEP = ['checkout', 'checkoutdate', 'departure', 'departuredate', 'departureon', 'enddate', 'dateto', 'todate'];
const REF = ['channelbookingreference', 'channelreference', 'channelbookingid', 'otareference', 'confirmationnumber', 'confirmationcode', 'bookingreference', 'reference', 'bookingid', 'reservationid', 'id'];
const CH = ['channelname', 'channel', 'bookingsource', 'sourcename', 'source', 'origin', 'otaname', 'bookedvia'];
const ST = ['status', 'state', 'bookingstatus', 'reservationstatus'];
const TOT = ['totalamount', 'grandtotal', 'totalprice', 'total', 'amount', 'price', 'totalcharge'];
const CUR = ['currency', 'currencycode'];
const RT = ['roomtypename', 'roomtype', 'roomname', 'unittypename', 'categoryname'];
const PAY = ['paymenttype', 'paymentmodel', 'paymentcollect', 'collecttype', 'paymentmethod', 'payment'];

function pick(o: Record<string, any>, keys: string[]): any {
  const m = new Map(Object.keys(o).map((k) => [norm(k), k]));
  for (const k of keys) { const real = m.get(k); if (real != null && o[real] != null && o[real] !== '') return o[real]; }
  return undefined;
}
const asDate = (v: any): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (d) return `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  return null;
};
const asNum = (v: any): number | null => {
  if (v && typeof v === 'object') v = v.amount ?? v.value ?? v.total;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: any): string | null => (v == null ? null : typeof v === 'object' ? (v.name ?? v.title ?? v.label ?? null) : String(v));

function guestOf(o: Record<string, any>) {
  const g = pick(o, ['guest', 'primaryguest', 'mainguest', 'customer', 'booker', 'contact']) ?? o;
  const gg = typeof g === 'object' ? g : {};
  const first = pick(gg, ['firstname', 'givenname']) ?? '';
  const last = pick(gg, ['lastname', 'surname', 'familyname']) ?? '';
  const full = pick(gg, ['fullname', 'name', 'guestname']) ?? pick(o, ['guestname', 'guestfullname', 'customername']) ?? `${first} ${last}`.trim();
  return {
    guest: String(full || '').trim(),
    email: text(pick(gg, ['email', 'emailaddress']) ?? pick(o, ['guestemail', 'email'])),
    phone: text(pick(gg, ['phone', 'phonenumber', 'mobile', 'telephone']) ?? pick(o, ['guestphone', 'phone'])),
    nationality: text(pick(gg, ['nationality', 'country', 'countrycode']) ?? pick(o, ['nationality', 'country'])),
  };
}

function roomTypeOf(o: Record<string, any>): string | null {
  const direct = text(pick(o, RT));
  if (direct) return direct;
  const rooms = pick(o, ['rooms', 'roomstays', 'reservedrooms', 'units', 'items']);
  if (Array.isArray(rooms) && rooms[0] && typeof rooms[0] === 'object') return text(pick(rooms[0], RT));
  return null;
}
function guestsOf(o: Record<string, any>): number {
  const n = asNum(pick(o, ['numberofguests', 'guests', 'guestcount', 'pax', 'occupancy']));
  if (n && n > 0) return Math.round(n);
  const a = asNum(pick(o, ['adults', 'numberofadults'])) ?? 0, c = asNum(pick(o, ['children', 'numberofchildren'])) ?? 0;
  return Math.max(1, Math.round(a + c));
}

/** Walks any JSON value and returns every object that looks like a booking. */
export function extractBookings(json: unknown): LhBooking[] {
  const out: LhBooking[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || v == null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const o = v as Record<string, any>;
    const checkIn = asDate(pick(o, ARR)), checkOut = asDate(pick(o, DEP));
    const ref = pick(o, REF);
    if (checkIn && checkOut && checkOut > checkIn && ref != null) {
      const g = guestOf(o);
      const channel = String(text(pick(o, CH)) ?? 'Unknown');
      const status = String(text(pick(o, ST)) ?? 'confirmed');
      out.push({
        key: `${norm(channel)}:${String(ref)}`, ref: String(ref), channel, status, cancelled: /cancel|void|no.?show|declin/i.test(status),
        ...g, checkIn, checkOut, guests: guestsOf(o), roomType: roomTypeOf(o),
        total: asNum(pick(o, TOT)), currency: text(pick(o, CUR)), paymentNote: text(pick(o, PAY)), raw: o,
      });
      return; // a booking's nested objects are not bookings themselves
    }
    for (const k of Object.keys(o)) visit(o[k], depth + 1);
  };
  visit(json, 0);
  return out;
}

/** Same booking can appear in several responses; keep the most complete copy. */
export function dedupe(list: LhBooking[]): LhBooking[] {
  const m = new Map<string, LhBooking>();
  const score = (b: LhBooking) => [b.guest, b.roomType, b.total, b.email, b.phone].filter((x) => x != null && x !== '').length;
  for (const b of list) { const p = m.get(b.key); if (!p || score(b) > score(p)) m.set(b.key, b); }
  return [...m.values()];
}

/** Our section for a Little Hotelier channel name (null = not a site booking, e.g. made inside Little Hotelier). */
export function channelKeyFor(b: LhBooking): 'booking_com' | 'airbnb' | 'hostelworld' | 'expedia_collect' | 'expedia_hotel' | 'agoda' | null {
  const c = b.channel.toLowerCase();
  if (/booking\.?com/.test(c)) return 'booking_com';
  if (/airbnb/.test(c)) return 'airbnb';
  if (/agoda/.test(c)) return 'agoda';
  if (/hostelworld|hostelbookers|hostels\.com/.test(c)) return 'hostelworld';
  if (/expedia|hotels\.com|vrbo/.test(c)) return /hotel.?collect|pay.?at.?(the.?)?(hotel|property)/i.test(`${b.paymentNote ?? ''} ${JSON.stringify(b.raw).slice(0, 2000)}`) ? 'expedia_hotel' : 'expedia_collect';
  return null;
}

/** Personal data removed, for the discovery report. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => redact(x, depth + 1)).concat(v.length > 3 ? [`… ${v.length - 3} more`] : []);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, /name|email|phone|mobile|address|card|passport|document|birth/i.test(k) && typeof x !== 'object' ? '[hidden]' : redact(x, depth + 1)]));
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 40) + '…' : v;
  return v;
}
