import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/base-url';
import { createEventBooking } from '@/services/events';
import { bookingWhatsAppLink } from '@/services/event-admin';
import { notifyNewEventBooking } from '@/services/admin-bot';
import { isSiteLang } from '@/i18n/site';
import { BookingError } from '@/services/errors';

/** Name + phone of each extra person, from att_name_N / att_phone_N. */
const attendeesOf = (raw: Record<string, any>) => {
  const out: { name: string; phone: string }[] = [];
  for (let i = 1; i <= 19; i++) {
    if (raw[`att_name_${i}`] == null && raw[`att_phone_${i}`] == null) continue;
    out.push({ name: String(raw[`att_name_${i}`] ?? '').trim(), phone: String(raw[`att_phone_${i}`] ?? '').trim() });
  }
  return out;
};

const schema = z.object({
  lang: z.string().default('ar'),
  slug: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.coerce.number().int().min(1).max(20),
  option: z.string().max(40).optional().nullable(),
  hotelGuest: z.union([z.boolean(), z.string()]).optional(),
  pwyw: z.string().trim().max(12).optional(),
  dinner: z.union([z.boolean(), z.string()]).optional(),
  stayRef: z.string().trim().max(20).optional().nullable(),
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  phone: z.string().trim().min(6).max(30),
  payMethod: z.enum(['paymob', 'instapay', 'vodafone_cash', 'cash']),
});

export async function POST(req: NextRequest) {
  try {
    let raw: Record<string, any> = {};
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      raw = await req.json().catch(() => ({}));
    } else {
      const fd = await req.formData().catch(() => null);
      if (fd) raw = Object.fromEntries(fd.entries());
    }

    const ip = await clientIp();
    if (!rateLimit('event:' + ip, 20, 10 * 60_000)) {
      return NextResponse.json({ ok: false, error: 'rate_limit' }, { status: 429 });
    }

    const p = schema.safeParse(raw);
    if (!p.success) {
      return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
    }

    const v = p.data;
    const isGuest = v.hotelGuest === true || v.hotelGuest === 'on' || v.hotelGuest === 'true';
    const isDinner = v.dinner === true || v.dinner === 'on' || v.dinner === 'true';

    // Hostel guest: how much they will pay for the tickets is required (same rule as the form).
    let pwywOfferCents: number | null = null;
    if (isGuest) {
      const n = Number(String(v.pwyw ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, ''));
      // Required only when the event is pay-what-you-want (the booking service checks it).
      if (v.pwyw) {
        if (!Number.isFinite(n) || n < 0 || n > 100000) return NextResponse.json({ ok: false, error: 'pwyw' }, { status: 400 });
        pwywOfferCents = Math.round(n * 100);
      }
    }

    const lang = isSiteLang(v.lang) ? v.lang : 'ar';

    const { booking } = await createEventBooking({
      slug: v.slug,
      date: v.date,
      quantity: v.quantity,
      optionKey: v.option || null,
      isHotelGuest: isGuest,
      stayReference: v.stayRef || null,
      pwywOfferCents,
      dinner: isDinner,
      fullName: v.fullName,
      email: v.email,
      phone: v.phone || null,
      language: lang,
      payMethod: v.payMethod,
      attendees: attendeesOf(raw), requireAttendees: true,
      addonEventId: typeof raw.addon === 'string' && /^[0-9a-f-]{36}$/i.test(raw.addon) ? raw.addon : null,
    });

    await notifyNewEventBooking(booking.id).catch((e) => console.error('[admin bot]', e));

    let waUrl = await bookingWhatsAppLink(booking.id).catch(() => null);
    if (!waUrl) {
      const num = '201040551515';
      const text = `مرحباً فيلا ليلى 👋\nحجز فعالية: ${v.slug}\nالتاريخ: ${v.date}\nالعدد: ${v.quantity}\nالاسم: ${v.fullName}\nالهاتف: ${v.phone}\nكود الحجز: ${booking.ticket_code}`;
      waUrl = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
    }

    return NextResponse.json({
      ok: true,
      ticketCode: booking.ticket_code,
      bookingId: booking.id,
      waUrl,
    });
  } catch (err: any) {
    // Booking rules (sold out, date gone, payment method not allowed…): tell the guest, never fake a booking.
    if (err instanceof BookingError) {
      return NextResponse.json({ ok: false, error: `${err.code.toLowerCase()}${err.message && err.message !== err.code ? ':' + err.message : ''}` }, { status: 400 });
    }
    console.error('[API /api/events/book error]:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal_error' }, { status: 500 });
  }
}
