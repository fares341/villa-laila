import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { hostelInfo, getSetting } from '@/services/settings';
import { publicRooms } from '@/services/public-rooms';
import { TOURS } from '@/content/tours';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, lang = 'en' } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 });
    }

    const apiKey = env.openrouterKey;
    if (!apiKey) {
      return NextResponse.json({
        reply: lang === 'ar'
          ? 'أهلاً بك في فيلا ليلى! يمكنك الاستفسار أو الحجز مباشرة عبر واتساب: +201000000000'
          : 'Welcome to Villa Layla! For inquiries, please reach out via WhatsApp or visit our booking page.'
      });
    }

    // Gather latest hostel information and rooms
    const [h, rooms, cur] = await Promise.all([
      hostelInfo().catch(() => ({}) as any),
      publicRooms().catch(() => []),
      getSetting<string>('currency').catch(() => 'EGP'),
    ]);

    const roomsSummary = rooms.map((r) => {
      const name = r.name?.[lang] || r.name?.en || r.code;
      const price = r.priceCents ? `${r.priceCents / 100} ${cur}/night` : 'Price on request';
      const kind = r.kind === 'dorm' ? `Dorm (${r.gender})` : 'Private room';
      const sleeps = r.capacity || r.details?.sleeps || 2;
      return `- ${name} (${kind}): ${price}, capacity: ${sleeps} guests. Features: ${(r.details?.features || []).join(', ') || 'AC, comfortable beds'}`;
    }).join('\n');

    const toursList = TOURS.map((t) => t.key).join(', ');

    const systemPrompt = `You are "Layla", the warm, intelligent, and welcoming AI Concierge for **Villa Layla Hostel** (نزل فيلا ليلى) located in Cairo, Egypt.

=== VILLA LAYLA FACT SHEET ===
- Name: Villa Layla Hostel (فيلا ليلى)
- Address: ${h.address || 'Cairo, Egypt'}
- Map Link: ${h.map_url || ''}
- WhatsApp: ${h.whatsapp || '+20 10 0000 0000'} (link: https://wa.me/${(h.whatsapp || '').replace(/\D/g, '')})
- Email: ${h.email || 'stay@villalaylahostel.com'}
- Check-in Time: from ${h.checkin_time || '14:00 (2:00 PM)'}
- Check-out Time: until ${h.checkout_time || '11:00 (11:00 AM)'}
- Front Desk: 24/7 reception desk always available to assist guests.
- Breakfast: Fresh, traditional Egyptian breakfast served daily.
- Amenities: Outdoor swimming pool, high-speed WiFi everywhere, rooftop/patio co-working spaces, air conditioning in all rooms, guest kitchen, luggage storage.
- Day Tours & Trips: Giza Pyramids & Sphinx, Islamic Cairo & Khan el-Khalili, Fayoum Oasis & Valley of Whales, White Desert & Black Desert camping, Saqqara & Dahshur, Nile Felucca sailing, Alexandria day trip. (Tours can be arranged easily via reception or WhatsApp).
- Payment Methods Accepted: Cash (Egyptian Pounds EGP, USD, EUR), Credit/Debit Cards, InstaPay (Egypt), Bank Wire Transfer.
- Cancellation Policy: Free cancellation up to 48 hours prior to arrival date.
- Booking Link: To reserve on our website, guests can go directly to /${lang}/book (or /ar/book for Arabic).

=== ROOMS & DORMS CATALOG ===
${roomsSummary || 'Private rooms and female/mixed dorms with AC and comfortable beds.'}

=== CRITICAL LANGUAGE AND BEHAVIOR INSTRUCTIONS ===
1. LANGUAGE RULE: ALWAYS detect the language and dialect of the guest's message and reply in that EXACT SAME language.
   - If the guest writes in Arabic (or Egyptian dialect: مصري), reply in friendly, helpful, hospitable Arabic/Egyptian Arabic.
   - If the guest writes in English, reply in natural, welcoming English.
   - If they write in French, Spanish, German, Italian, Russian, Turkish, etc., reply in that language.
2. TONE: Warm, genuine Egyptian hospitality, concise and helpful (avoid overly robotic corporate speak).
3. ACCURACY: Stick strictly to the facts above. If a guest asks about custom tours, large groups (>10), or airport pickup, mention that our reception desk / WhatsApp can arrange it right away.
4. CALL TO ACTION: When relevant, warmly encourage them to check availability and book on our site (/ar/book or /en/book) or message on WhatsApp.`;

    const recentMessages = messages.slice(-10).map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000),
    }));

    const payload = {
      model: env.openrouterModel || 'google/gemini-2.5-flash',
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        ...recentMessages,
      ],
    };

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': env.baseUrl || 'https://villalaylahostel.com',
        'X-Title': 'Villa Layla Hostel',
      },
      body: JSON.stringify(payload),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('[Public Chat AI Error]', aiRes.status, errText);
      return NextResponse.json({
        reply: lang === 'ar'
          ? 'أهلاً بك! نعتذر عن التأخير المؤقت، يمكنك التواصل معنا مباشرة عبر واتساب أو تصفح غرفنا للحجز الفوري.'
          : 'Welcome to Villa Layla! We are available on WhatsApp for instant assistance or feel free to browse our rooms.'
      });
    }

    const json = await aiRes.json();
    const reply = json?.choices?.[0]?.message?.content || (
      lang === 'ar' ? 'أهلاً بك في فيلا ليلى! كيف يمكنني مساعدتك اليوم؟' : 'Welcome to Villa Layla! How may I help you today?'
    );

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error('[Public Chat API Exception]', err);
    return NextResponse.json({
      reply: 'Welcome to Villa Layla! Please feel free to ask any question or check our booking page.'
    }, { status: 200 });
  }
}
