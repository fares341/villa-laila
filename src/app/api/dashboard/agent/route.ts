import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { env } from '@/lib/env';
import { todayLocal } from '@/lib/dates';
import { executeAgentTool, DASHBOARD_TOOLS, getLiveOperationalSnapshot } from '@/services/dashboard-agent';
import { executiveBriefing } from '@/services/pms/insights';
import { can } from '@/lib/permissions';

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
        reply: 'The assistant is not configured: set OPENROUTER_API_KEY on the server.'
      });
    }

    const today = todayLocal();
    const snapshot = await getLiveOperationalSnapshot().catch((err) => {
      console.error('[Dashboard Agent Live Snapshot Error]', err);
      return null;
    });

    const exec = can(user.role, 'reports.view') ? await executiveBriefing().catch(() => null) : null;

    const systemPrompt = `You are the executive assistant for Villa Layla Hostel, Cairo (internal staff dashboard).
Staff user: ${user.name} (${user.role}). Today: ${today}. Currency: EGP.

You are READ-ONLY. You answer questions about operations, revenue, stock, guests, shifts and staff from the data below and from your tools.
You never create, change, approve or delete anything. When asked to do something (book, check in, record a sale or payment, approve InstaPay,
change a price), say it must be done in the dashboard or on the POS so it is recorded and audited, and give the page link:
- Movement cockpit (check-in / check-out / walk-in): /dashboard/frontdesk
- Guest folio (charges, payments, room move, rate override): /dashboard/folio/<reservation id>
- POS (sales, charge to room, owner comp, shift close): /pos
- Events & InstaPay approvals: /dashboard/events
- Catalog & stock: /dashboard/catalog  - Staff & roster: /dashboard/staff  - Attendance: /dashboard/staff/timesheet
- Shifts & Z-reports, owner allowances: /dashboard/shift-reports  - Little Hotelier rates: /dashboard/channel

LIVE SNAPSHOT
- Occupancy: ${snapshot?.operationsToday?.occupancy || 'n/a'} · In house: ${snapshot?.operationsToday?.inHouseCount || 'n/a'} · Free tonight: ${snapshot?.operationsToday?.freeTonight || 'n/a'} · Pending requests: ${snapshot?.operationsToday?.pendingReviewCount || 0}
- Arrivals today: ${JSON.stringify(snapshot?.operationsToday?.arrivalsToday || [])}
- Departures today: ${JSON.stringify(snapshot?.operationsToday?.departuresToday || [])}
- In-house guests: ${JSON.stringify(snapshot?.operationsToday?.inHouseGuests || [])}
- Open balances (folio): ${JSON.stringify(snapshot?.unpaidBalances || [])}
- Room types and tonight's base rates: ${JSON.stringify(snapshot?.roomsCatalog || [])}
${exec ? `
EXECUTIVE KPIs (managers and owners)
- Revenue collected today: ${JSON.stringify(exec.revenueToday)}
- Low stock: ${JSON.stringify(exec.lowStock)}
- In-house guests unpaid for more than 1 day: ${JSON.stringify(exec.unpaidInHouseOver1Day)}
- Recent POS shifts: ${JSON.stringify(exec.recentShifts)}
- Late today: ${JSON.stringify(exec.lateToday)}` : ''}

TOOLS
Use tools for anything beyond the snapshot: get_revenue, get_market_sales, get_event_profit, get_low_stock, get_unpaid_in_house (minDays),
get_shift_reports, get_attendance (month), plus reservation and guest search, availability and the financial report.
Call the tool before answering; never guess numbers.

STYLE
- Reply in the language the staff member writes in (Egyptian Arabic or English). Be concise and factual, like an operations manager.
- Use short markdown lists and bold labels. Do not use emojis.
- Quote money as "EGP 1,250". Revenue means money collected unless the user asks for posted charges.
- Link reservations as [Guest name - REF](/dashboard/folio/ID).`;

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
