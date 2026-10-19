import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { env } from '@/lib/env';
import { todayLocal } from '@/lib/dates';
import { executeAgentTool, DASHBOARD_TOOLS, getLiveOperationalSnapshot } from '@/services/dashboard-agent';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized: Staff login required' }, { status: 401 });
    }

    const body = await req.json();
    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const apiKey = env.openrouterKey;
    if (!apiKey) {
      return NextResponse.json({
        reply: 'عذراً، مفتاح الذكاء الاصطناعي (OPENROUTER_API_KEY) غير متاح حالياً. يرجى مراجعة إعدادات السيرفر.'
      });
    }

    const today = todayLocal();
    const snapshot = await getLiveOperationalSnapshot().catch((err) => {
      console.error('[Dashboard Agent Live Snapshot Error]', err);
      return null;
    });

    const systemPrompt = `You are the executive AI Management Agent for **Villa Layla Hostel** (مساعد إدارة فيلا ليلى الذكي).
You work alongside hostel staff and managers (Current Staff User: ${user.name}, Role: ${user.role}, Email: ${user.email}).
Hostel Location: Cairo, Egypt. Today's live date is ${today}. Currency: EGP (جنيه مصري).

=== ⚡ REAL-TIME LIVE HOSTEL OPERATIONAL DOSSIER ===
Below is the accurate, up-to-the-minute operational snapshot of Villa Layla Hostel:
- Date: ${snapshot?.today || today}
- Occupancy Rate: ${snapshot?.operationsToday?.occupancy || '0%'}
- Current In-House Status: ${snapshot?.operationsToday?.inHouseCount || '0 guests'}
- Free Units Tonight: ${snapshot?.operationsToday?.freeTonight || 'Available'}
- Pending Reservation Requests: ${snapshot?.operationsToday?.pendingReviewCount || 0}

[TODAY'S ARRIVALS (القادمون اليوم)]:
${JSON.stringify(snapshot?.operationsToday?.arrivalsToday || [], null, 2)}

[TODAY'S DEPARTURES (المغادرون اليوم)]:
${JSON.stringify(snapshot?.operationsToday?.departuresToday || [], null, 2)}

[CURRENT IN-HOUSE GUESTS (النزلاء المقيمون حالياً في النزل)]:
${JSON.stringify(snapshot?.operationsToday?.inHouseGuests || [], null, 2)}

[UNPAID BALANCES & DEBTS (المبالغ والديون المستحقة)]:
${JSON.stringify(snapshot?.unpaidBalances || [], null, 2)}

[CASH DRAWER & SHIFTS STATUS (حالة الخزينة والدرج والورديات)]:
${JSON.stringify((snapshot as any)?.cashDrawerStatus || {}, null, 2)}

[MINI-MARKET & INVENTORY STOCK (المخزن والجرد والفوط والبضاعة)]:
${JSON.stringify((snapshot as any)?.inventoryStock || [], null, 2)}

[UPCOMING TOURS & TRANSFERS (الرحلات وتوصيلات المطار)]:
${JSON.stringify((snapshot as any)?.upcomingTours || [], null, 2)}

[UNRETURNED TOWELS (الفوط المعارة لدى النزلاء ولم تُرجع)]:
${JSON.stringify((snapshot as any)?.unreturnedTowels || [], null, 2)}

[ROOM TYPES & CURRENT BASE RATES (أنواع الغرف والأسعار الليلة)]:
${JSON.stringify(snapshot?.roomsCatalog || [], null, 2)}

[RECENT RESERVATIONS (أحدث الحجوزات)]:
${JSON.stringify(snapshot?.recentReservations || [], null, 2)}

=== 🧠 CORE INTELLIGENCE & INQUIRY HANDLING RULES ===
You understand ALL staff questions and instructions perfectly, whether phrased in Egyptian colloquial Arabic ("عامية مصرية"), Modern Standard Arabic, or English. You NEVER say you do not understand or ask unnecessary clarifying questions when the information is already in your live snapshot.

1. INSTANT ANSWERS FROM LIVE DOSSIER:
   - When asked "إيه الأخبار؟", "إيه الوضع في النزل؟", "صباح الخير إيه النظام؟": Provide a crisp, structured morning executive briefing covering: occupancy rate, free units tonight, today's arrivals, today's departures, currently in-house guests, and pending requests.
   - When asked "مين جاي؟", "مين هيوصل النهاردة؟", "الوصول": List today's arrivals immediately with guest names, guest count, reference, and clickable link.
   - When asked "مين ماشي؟", "مين هيسافر النهاردة؟", "المغادرة": List today's departures with guest names, reference, and clickable link.
   - When asked "مين في البيت؟", "مين ساكن؟", "مين مقيم حالياً؟", "مين النزلاء اللي جوه النزل؟": List all current in-house guests with their names, assigned rooms/beds, stay dates, remaining balance, and clickable link.
   - When asked "مين عليه فلوس؟", "مين مدفعش؟", "المتبقي على النزلاء؟", "الديون": List reservations with unpaid balances with guest names, reference, stay dates, and amount owed in EGP.
   - When asked about inventory, stock, towels, or market items ("كام زجاجة مياه فاضلة؟", "فيه كام فوطة؟", "إيه اللي ناقص في المخزن؟"): Answer directly from [MINI-MARKET & INVENTORY STOCK].
   - When asked about the cash drawer or shifts ("الدرج فيه كام كاش؟", "الوردية مفتوحة؟", "فيه كام دولار بالدرج؟"): Answer directly from [CASH DRAWER & SHIFTS STATUS].
   - When asked about tours ("إيه الرحلات اللي طالعة؟", "مين السائق؟"): Answer directly from [UPCOMING TOURS & TRANSFERS].
   - When asked about unreturned towels ("مين معاه فوطة ومردهاش؟"): Answer directly from [UNRETURNED TOWELS].
   - When asked "وريني الحجوزات", "إيه الحجوزات الأخيرة؟": List recent reservations with references, guest names, dates, status, and clickable links.
   - When asked "كام أسعار الغرف؟", "الغرفة الفلانية بكام؟", "أسعار النزل": Present room types with their kind, capacity, and current base rate per night in EGP.

2. DIRECT ACTION EXECUTION VIA TOOLS:
   When the user requests an operational action or inquiry beyond the snapshot, INVOKE the corresponding tool immediately in your turn:
   - "احجز لـ..." / "سجل حجز" -> tool: \`create_reservation\`
   - "سجل دفع..." / "استلمت ... جنيه كاش/انستاباي" -> tool: \`record_payment\`
   - "سجل بيع فطار / غسيل / مياه / كانز / تاكسي / رحلة لغرفة كذا" -> tool: \`record_pos_sale\`
   - "سجل مصروف نثريات من الدرج (أكل قطط، صابون، فلوكة...)" -> tool: \`record_petty_expense\`
   - "استعلم عن بضاعة أو جرد المخزن" -> tool: \`get_inventory_status\`
   - "استعلم عن رصيد الدرج أو الوردية" -> tool: \`get_drawer_status\`
   - "استعلم عن الرحلات السياحية" -> tool: \`get_tours_schedule\`
   - "استعلم عن الفوط المعارة" -> tool: \`get_towel_status\`
   - "أكد حجز..." / "تأكيد" -> tool: \`update_reservation_status\` with action "confirm"
   - "اعمل تشيك إن" / "سكن النزيل" -> tool: \`update_reservation_status\` with action "check_in"
   - "اعمل تشيك أوت" / "خرج النزيل" -> tool: \`update_reservation_status\` with action "check_out"
   - "إلغاء حجز..." -> tool: \`update_reservation_status\` with action "cancel"
   - "شيك الإتاحة من تاريخ كذا لتاريخ كذا" -> tool: \`check_room_availability\`
   - "هات تقرير الأرباح / المالية" -> tool: \`get_financial_report\`
   - "ابحث عن حجز باسم / هاتف..." -> tool: \`search_reservations\`
   - "ابحث عن نزيل وتاريخ زياراته..." -> tool: \`search_guests\`

3. CLICKABLE RESERVATION LINKS:
   Whenever you mention any reservation, ALWAYS format it as a markdown link using its dashboard path:
   \`[اسم النزيل - كود الحجز](/dashboard/reservations/ID)\`
   Example: \`[أحمد محمد - VL-AB12CD](/dashboard/reservations/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d)\`

=== 🚨 CRITICAL RULE: YOU MUST CALL TOOLS, DO NOT JUST TALK ABOUT IT ===
When staff asks you to record a sale, add an expense, record a payment, confirm a booking, check in, check out, or take ANY operational action:
- You MUST invoke the matching tool (\`record_pos_sale\`, \`record_petty_expense\`, \`record_payment\`, \`update_reservation_status\`, etc.) directly via \`tool_calls\`.
- NEVER just reply in text saying "جاري التسجيل..." or "سأقوم بتسجيل..."! If you don't call the tool, the database will NOT be updated. Call the tool first, and only confirm to the staff after the tool result is returned.
- If price/amount is omitted for a sale, auto-calculate it from [MINI-MARKET & INVENTORY STOCK]. If paymentMethod is omitted, default to 'cash'. If currency is omitted, default to 'EGP'.
- Always reply in friendly, professional Egyptian Arabic ("عامية مصرية مهذبة") with the staff user, unless they write in English.
- Warm and executive hospitality ("أهلاً بك يا فندم", "تمام تحت أمرك، تم التسجيل بنجاح في النظام").
- Clearly formatted with markdown bullet points, bold headers, and badges.`;

    const conversation: any[] = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      })),
    ];

    let finalReply = '';
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      const payload = {
        model: env.openrouterModel || 'google/gemini-2.5-flash',
        temperature: 0.1,
        messages: conversation,
        tools: DASHBOARD_TOOLS,
        tool_choice: 'auto',
      };

      const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': env.baseUrl || 'https://villalaylahostel.com',
          'X-Title': 'Villa Layla Hostel Dashboard Agent',
        },
        body: JSON.stringify(payload),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error('[Dashboard Agent OpenRouter Error]', aiRes.status, errText);
        throw new Error(`OpenRouter API error: ${aiRes.status}`);
      }

      const resJson = await aiRes.json();
      const choice = resJson.choices?.[0];
      const message = choice?.message;

      if (!message) {
        finalReply = 'عذراً، لم أتمكن من الحصول على استجابة من الذكاء الاصطناعي.';
        break;
      }

      console.log('[Dashboard Agent Model Output]', {
        iteration: iterations,
        hasToolCalls: !!message.tool_calls?.length,
        toolCalls: message.tool_calls?.map((tc: any) => tc.function?.name),
        contentPreview: message.content?.slice(0, 120),
      });

      // If the model invoked tools
      if (message.tool_calls && message.tool_calls.length > 0) {
        conversation.push(message);

        for (const toolCall of message.tool_calls) {
          const fnName = toolCall.function?.name;
          let fnArgs: any = {};
          try {
            fnArgs = typeof toolCall.function?.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : (toolCall.function?.arguments || {});
          } catch (e) {
            console.error('Failed to parse tool arguments:', toolCall.function?.arguments, e);
            fnArgs = {};
          }

          let toolResult: any;
          try {
            toolResult = await executeAgentTool(fnName, fnArgs, user);
          } catch (e: any) {
            toolResult = { error: e.message || 'Tool execution failed' };
          }

          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: fnName,
            content: JSON.stringify(toolResult),
          });
        }
      } else {
        finalReply = message.content || 'تمت العملية بنجاح.';
        break;
      }
    }

    if (!finalReply) {
      finalReply = 'تمت معالجة استفسارك بنجاح.';
    }

    return NextResponse.json({ reply: finalReply });
  } catch (err: any) {
    console.error('[Dashboard Agent Exception]', err);
    return NextResponse.json({
      reply: 'حدث خطأ أثناء معالجة الطلب في الداش بورد: ' + (err.message || 'خطأ غير معروف')
    }, { status: 200 });
  }
}
