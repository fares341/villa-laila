import { q } from '@/lib/db';
import { can } from '@/lib/permissions';
import * as insights from './pms/insights';
import { overview, reservationRows, calendarData, reportData } from './queries';
import {
  createReservation,
  confirmReservation,
  cancelReservation,
  rejectReservation,
  markNoShow,
} from './reservations';
import { checkInGuest, checkOutGuest } from './pms/frontdesk';
import { openShiftRow, shiftTotals, takeFolioPayment } from './pms/pos';
import { toursList } from './pms/tasks';
import { recordPayment, verifyPayment, type PaymentMethod, METHODS } from './payments';
import { getSetting, hostelInfo } from './settings';
import { freeUnits } from './availability';
import { quote } from './pricing';
import type { SessionUser } from '@/lib/auth';
import {
  getProducts,
  createProduct,
  updateProduct,
} from './frontdesk';

/** Fetches a comprehensive live snapshot of hostel operations to feed into the agent's context */
export async function getLiveOperationalSnapshot() {
  const [o, h, cur, roomTypes, inHouseList, recentBookings, unpaidList, invList, drawer, upcomingTours] = await Promise.all([
    overview().catch(() => null),
    hostelInfo().catch(() => ({}) as any),
    getSetting<string>('currency').catch(() => 'EGP'),
    q<any>(`
      SELECT t.id, t.code, t.name, t.kind, t.gender,
        (SELECT max(u.capacity) FROM units u JOIN rooms r ON r.id=u.room_id WHERE r.room_type_id=t.id AND u.active) AS capacity,
        (SELECT price_cents FROM rates r WHERE r.room_type_id=t.id AND r.valid_during @> CURRENT_DATE ORDER BY priority DESC LIMIT 1) AS price_cents
      FROM room_types t WHERE t.active ORDER BY t.sort_order
    `).catch(() => []),
    q<any>(`
      SELECT r.id, r.reference, g.full_name, g.phone, t.name rt_name, t.code rt_code, r.check_in, r.check_out, r.guests_count,
             (folio_charges(r.id) - COALESCE(p.paid,0))::bigint as balance_cents,
             (SELECT string_agg(rm.name || ' / ' || u.label, ', ') FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=r.id AND ru.active) beds
      FROM reservations r
      JOIN guests g ON g.id=r.guest_id
      JOIN room_types t ON t.id=r.room_type_id
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0) paid FROM payments WHERE reservation_id=r.id) p ON true
      WHERE r.status = 'checked_in'
      ORDER BY r.check_out
    `).catch(() => []),
    q<any>(`
      SELECT r.id, r.reference, g.full_name, g.phone, r.status, r.check_in, r.check_out, r.total_cents, folio_charges(r.id)::bigint charges_cents,
             COALESCE(p.paid, 0)::bigint AS paid_cents, t.name rt_name
      FROM reservations r
      JOIN guests g ON g.id=r.guest_id
      JOIN room_types t ON t.id=r.room_type_id
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0) paid FROM payments WHERE reservation_id=r.id) p ON true
      ORDER BY r.created_at DESC
      LIMIT 12
    `).catch(() => []),
    q<any>(`
      SELECT r.id, r.reference, g.full_name, g.phone, r.status, r.check_in, r.check_out,
             (folio_charges(r.id) - COALESCE(p.paid,0))::bigint AS balance_cents, r.total_cents
      FROM reservations r
      JOIN guests g ON g.id=r.guest_id
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0) paid FROM payments WHERE reservation_id=r.id) p ON true
      WHERE r.status IN ('confirmed','checked_in') AND (folio_charges(r.id) - COALESCE(p.paid,0)) > 0
      ORDER BY balance_cents DESC
      LIMIT 8
    `).catch(() => []),
    q<any>(`
      SELECT id, name, category, stock_quantity, track_stock, low_stock_threshold, price_cents, cost_cents, currency
      FROM products WHERE is_active ORDER BY category, name
    `).catch(() => []),
    openShiftRow().then(async (sh) => (sh ? { sh, t: await shiftTotals(sh.id) } : null)).catch(() => null),
    toursList().catch(() => []),
  ]);


  return {
    today: o?.today || new Date().toISOString().slice(0, 10),
    hostel: {
      name: 'Villa Layla Hostel (فيلا ليلى)',
      address: h.address || 'Cairo, Egypt',
      phone: h.phone || '+201040551515',
      whatsapp: h.whatsapp || '+201040551515',
      currency: cur,
      checkInTime: h.checkin_time || '14:00',
      checkOutTime: h.checkout_time || '11:00',
    },
    operationsToday: {
      occupancy: `${o?.occupancy ?? 0}%`,
      inHouseCount: `${o?.inHouse?.n ?? inHouseList.length} guests (${o?.inHouse?.res ?? inHouseList.length} bookings)`,
      freeTonight: o ? `${o.inv.bookable - o.inv.occupied} of ${o.inv.bookable} units free` : 'Available',
      pendingReviewCount: o?.pending ?? 0,
      arrivalsToday: (o?.arrivals || []).map((r: any) => ({
        reference: r.reference,
        guestName: r.full_name,
        guestsCount: r.guests_count,
        status: r.status,
        link: `/dashboard/reservations/${r.id}`
      })),
      departuresToday: (o?.departures || []).map((r: any) => ({
        reference: r.reference,
        guestName: r.full_name,
        guestsCount: r.guests_count,
        status: r.status,
        link: `/dashboard/reservations/${r.id}`
      })),
      inHouseGuests: inHouseList.map((r: any) => ({
        reference: r.reference,
        guestName: r.full_name,
        room: r.rt_name?.ar || r.rt_name?.en || r.rt_code,
        beds: r.beds || 'Assigned',
        stay: `${r.check_in} to ${r.check_out}`,
        balanceEgp: r.balance_cents / 100,
        link: `/dashboard/reservations/${r.id}`
      }))
    },
    cashDrawerStatus: drawer ? {
      status: 'Open shift',
      shiftNo: drawer.sh.shift_no,
      cashier: drawer.sh.staff_name,
      expectedInDrawer: { EGP: drawer.t.currencies.EGP.expected / 100, USD: drawer.t.currencies.USD.expected / 100, EUR: drawer.t.currencies.EUR.expected / 100 },
      expensesEgp: drawer.t.expenses / 100,
    } : { status: 'No open shift (الدرج مغلق أو لم يتم فتح وردية بعد)' },
    inventoryStock: (invList || []).map((p: any) => ({
      name: p.name,
      category: p.category,
      stockQuantity: p.track_stock ? p.stock_quantity : 'Unlimited (خدمة)',
      price: `${p.price_cents / 100} ${p.currency}`,
      lowStockAlert: p.track_stock && p.stock_quantity <= p.low_stock_threshold,
    })),
    upcomingTours: (upcomingTours || []).map((t: any) => ({ guest: t.guest_name, room: t.room_number, tour: t.item_name, pax: t.quantity, date: t.order_date, payment: t.payment_status })),
    roomsCatalog: roomTypes.map((rt: any) => ({
      code: rt.code,
      name: rt.name?.ar ? `${rt.name.ar} (${rt.name.en || rt.code})` : (rt.name?.en || rt.code),
      kind: rt.kind,
      capacity: rt.capacity || 2,
      baseRateEgp: rt.price_cents ? `${rt.price_cents / 100} ${cur}` : 'Set in Rates',
    })),
    recentReservations: recentBookings.map((r: any) => ({
      reference: r.reference,
      guestName: r.full_name,
      room: r.rt_name?.ar || r.rt_name?.en,
      stay: `${r.check_in} → ${r.check_out}`,
      status: r.status,
      totalEgp: r.total_cents / 100,
      balanceEgp: (r.charges_cents - r.paid_cents) / 100,
      link: `/dashboard/reservations/${r.id}`
    })),
    unpaidBalances: unpaidList.map((r: any) => ({
      reference: r.reference,
      guestName: r.full_name,
      stay: `${r.check_in} → ${r.check_out}`,
      status: r.status,
      balanceEgp: r.balance_cents / 100,
      link: `/dashboard/reservations/${r.id}`
    }))
  };
}

/** The executive assistant only reads. Every change goes through the dashboard or the POS, where it is audited. */
const READ_ONLY_BASE = new Set([
  'get_today_overview', 'get_in_house_guests', 'get_unpaid_balances', 'search_reservations', 'get_reservation_details',
  'check_room_availability', 'search_guests', 'get_financial_report', 'get_inventory_status', 'get_drawer_status', 'get_tours_schedule',
]);
const isReadOnly = (name: string) => READ_ONLY_BASE.has(name) || name in EXEC_TOOLS;

export async function executeAgentTool(name: string, args: any, user: SessionUser): Promise<any> {
  if (!isReadOnly(name)) return { error: 'The assistant is read-only. Do this in the dashboard or on the POS so it is recorded and audited.' };
  if (EXEC_TOOLS[name]) {
    if (!can(user.role, 'reports.view') && name !== 'get_low_stock') return { error: 'This report is for managers and owners.' };
    return EXEC_TOOLS[name](args ?? {});
  }
  const actor = user.email || 'staff@villalayla.com';
  const userId = user.id;

  switch (name) {
    case 'get_today_overview': {
      const o = await overview();
      const inHouseList = await q<any>(`
        SELECT r.id, r.reference, g.full_name, g.phone, t.name rt_name, r.check_in, r.check_out, r.guests_count,
               (SELECT string_agg(rm.name || ' / ' || u.label, ', ') FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=r.id AND ru.active) beds
        FROM reservations r
        JOIN guests g ON g.id=r.guest_id
        JOIN room_types t ON t.id=r.room_type_id
        WHERE r.status = 'checked_in'
        ORDER BY r.check_out
      `);
      return {
        today: o.today,
        occupancyRate: `${o.occupancy}%`,
        inHouseGuestsCount: o.inHouse.n,
        inHouseBookingsCount: o.inHouse.res,
        freeTonight: `${o.inv.bookable - o.inv.occupied} of ${o.inv.bookable} units`,
        pendingRequestsCount: o.pending,
        arrivalsToday: o.arrivals.map((r: any) => ({
          reference: r.reference,
          guestName: r.full_name,
          guestsCount: r.guests_count,
          status: r.status,
          link: `/dashboard/reservations/${r.id}`
        })),
        departuresToday: o.departures.map((r: any) => ({
          reference: r.reference,
          guestName: r.full_name,
          guestsCount: r.guests_count,
          status: r.status,
          link: `/dashboard/reservations/${r.id}`
        })),
        inHouseGuestsList: inHouseList.map((r: any) => ({
          reference: r.reference,
          guestName: r.full_name,
          phone: r.phone,
          room: r.rt_name?.ar || r.rt_name?.en,
          beds: r.beds,
          stay: `${r.check_in} to ${r.check_out}`,
          link: `/dashboard/reservations/${r.id}`
        }))
      };
    }

    case 'get_in_house_guests': {
      const rows = await q<any>(`
        SELECT r.id, r.reference, g.full_name, g.phone, g.nationality, t.name rt_name, r.check_in, r.check_out, r.guests_count,
               r.total_cents, folio_charges(r.id)::bigint charges_cents, COALESCE(p.paid,0)::bigint as paid_cents,
               (SELECT string_agg(rm.name || ' / ' || u.label, ', ') FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=r.id AND ru.active) beds
        FROM reservations r
        JOIN guests g ON g.id=r.guest_id
        JOIN room_types t ON t.id=r.room_type_id
        LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0) paid FROM payments WHERE reservation_id=r.id) p ON true
        WHERE r.status = 'checked_in'
        ORDER BY r.check_out
      `);
      return rows.map((r: any) => ({
        id: r.id,
        reference: r.reference,
        guestName: r.full_name,
        phone: r.phone,
        nationality: r.nationality,
        room: r.rt_name?.ar || r.rt_name?.en,
        beds: r.beds,
        checkIn: r.check_in,
        checkOut: r.check_out,
        totalEgp: r.total_cents / 100,
        balanceEgp: (r.charges_cents - r.paid_cents) / 100,
        link: `/dashboard/reservations/${r.id}`
      }));
    }

    case 'get_unpaid_balances': {
      const rows = await q<any>(`
        SELECT r.id, r.reference, g.full_name, g.phone, r.status, r.check_in, r.check_out,
               (folio_charges(r.id) - COALESCE(p.paid,0))::bigint AS balance_cents, r.total_cents, folio_charges(r.id)::bigint charges_cents, COALESCE(p.paid,0)::bigint as paid_cents
        FROM reservations r
        JOIN guests g ON g.id=r.guest_id
        LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0) paid FROM payments WHERE reservation_id=r.id) p ON true
        WHERE r.status IN ('confirmed','checked_in','checked_out') AND (folio_charges(r.id) - COALESCE(p.paid,0)) > 0
        ORDER BY balance_cents DESC
        LIMIT 15
      `);
      return rows.map((r: any) => ({
        id: r.id,
        reference: r.reference,
        guestName: r.full_name,
        phone: r.phone,
        status: r.status,
        stay: `${r.check_in} to ${r.check_out}`,
        totalEgp: r.total_cents / 100,
        paidEgp: r.paid_cents / 100,
        balanceEgp: r.balance_cents / 100,
        link: `/dashboard/reservations/${r.id}`
      }));
    }

    case 'search_reservations': {
      const rows = await reservationRows({
        q: args.q || undefined,
        status: args.status || undefined,
        payment: args.payment || undefined,
        from: args.from || undefined,
        to: args.to || undefined,
        limit: args.limit || 12,
      });
      return rows.map((r: any) => ({
        id: r.id,
        reference: r.reference,
        guestName: r.full_name,
        phone: r.phone,
        roomName: r.rt_name?.ar || r.rt_name?.en || r.rt_name,
        checkIn: r.check_in,
        checkOut: r.check_out,
        guestsCount: r.guests_count,
        status: r.status,
        totalEgp: r.total_cents / 100,
        paidEgp: r.paid / 100,
        balanceEgp: r.balance / 100,
        payState: r.payState,
        link: `/dashboard/reservations/${r.id}`,
      }));
    }

    case 'get_reservation_details': {
      const refOrId = String(args.referenceOrId || '').trim();
      const rows = await q<any>(
        `SELECT r.*, folio_charges(r.id)::bigint charges_cents, g.full_name, g.phone, g.email, g.nationality, g.language,
                t.name rt_name, t.code rt_code, t.kind rt_kind,
                COALESCE((SELECT SUM(amount_cents) FILTER (WHERE status='verified') FROM payments WHERE reservation_id=r.id),0)::bigint paid,
                (SELECT string_agg(rm.name || ' / ' || u.label, ', ') FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=r.id AND ru.active) units_allocated
         FROM reservations r
         JOIN guests g ON g.id=r.guest_id
         JOIN room_types t ON t.id=r.room_type_id
         WHERE r.reference ILIKE $1 OR r.id::text = $1`,
        [refOrId]
      );
      if (!rows.length) return { error: `Reservation '${refOrId}' not found in database.` };
      const r = rows[0];
      return {
        id: r.id,
        reference: r.reference,
        guest: {
          name: r.full_name,
          phone: r.phone,
          email: r.email,
          nationality: r.nationality,
        },
        stay: {
          checkIn: r.check_in,
          checkOut: r.check_out,
          guestsCount: r.guests_count,
          roomType: r.rt_name?.ar ? `${r.rt_name.ar} (${r.rt_name.en || r.rt_code})` : (r.rt_name?.en || r.rt_code),
          allocatedUnits: r.units_allocated || 'None assigned yet',
        },
        financials: {
          totalEgp: r.total_cents / 100,
          paidEgp: r.paid / 100,
          balanceEgp: (r.charges_cents - r.paid) / 100,
          currency: r.currency,
        },
        status: r.status,
        staffNotes: r.staff_notes,
        guestNotes: r.guest_notes,
        createdAt: r.created_at,
        link: `/dashboard/reservations/${r.id}`,
      };
    }

    case 'check_room_availability': {
      const { checkIn, checkOut, guestsCount = 1 } = args;
      const roomTypes = await q<any>('SELECT * FROM room_types WHERE active ORDER BY sort_order');
      const results: any[] = [];
      for (const rt of roomTypes) {
        try {
          const free = await freeUnits(q as any, rt.id, checkIn, checkOut);
          const isAvailable = rt.kind === 'dorm' ? free.length >= guestsCount : free.length > 0;
          let priceQuote = null;
          if (isAvailable) {
            const qt = await quote(q as any, rt.id, checkIn, checkOut, rt.kind === 'dorm' ? guestsCount : 1).catch(() => null);
            if (qt) priceQuote = `${qt.totalCents / 100} EGP total`;
          }
          results.push({
            roomTypeId: rt.id,
            roomCode: rt.code,
            name: rt.name?.ar ? `${rt.name.ar} (${rt.name.en || rt.code})` : (rt.name?.en || rt.code),
            kind: rt.kind,
            availableUnitsCount: free.length,
            isAvailable,
            priceQuote,
          });
        } catch {
          // ignore
        }
      }
      return { checkIn, checkOut, guestsCount, roomTypes: results };
    }

    case 'create_reservation': {
      const { guestName, phone, email, roomTypeCode, roomTypeId, checkIn, checkOut, guestsCount = 1, status = 'confirmed', notes } = args;
      let targetRoomTypeId = roomTypeId;
      if (!targetRoomTypeId) {
        const matching = await q<any>(
          `SELECT id FROM room_types WHERE active AND (code ILIKE $1 OR name->>'en' ILIKE $1 OR name->>'ar' ILIKE $1) LIMIT 1`,
          [`%${roomTypeCode || 'private'}%`]
        );
        if (matching.length) targetRoomTypeId = matching[0].id;
        else {
          const anyRt = await q<any>('SELECT id FROM room_types WHERE active ORDER BY sort_order LIMIT 1');
          targetRoomTypeId = anyRt[0]?.id;
        }
      }

      const res = await createReservation({
        guest: { fullName: guestName, phone: phone || null, email: email || null },
        roomTypeId: targetRoomTypeId,
        checkIn,
        checkOut,
        guestsCount: Number(guestsCount),
        source: 'staff',
        status: status === 'pending' ? 'pending' : 'confirmed',
        staffNotes: notes || 'Created via Dashboard AI Agent',
        actor,
        createdBy: userId,
      });

      return {
        success: true,
        message: `Reservation created successfully! Reference: ${res.reference}`,
        reservationId: res.id,
        reference: res.reference,
        status: res.status,
        totalEgp: res.total_cents / 100,
        link: `/dashboard/reservations/${res.id}`,
      };
    }

    case 'update_reservation_status': {
      const { reservationIdOrRef, action, reason } = args;
      const refOrId = String(reservationIdOrRef || '').trim();
      const rows = await q<any>('SELECT id, reference, status FROM reservations WHERE reference ILIKE $1 OR id::text = $1', [refOrId]);
      if (!rows.length) return { error: `Reservation '${refOrId}' not found.` };
      const r = rows[0];

      switch (action) {
        case 'confirm':
          await confirmReservation(r.id, actor, userId);
          return { success: true, message: `Reservation ${r.reference} confirmed successfully.`, link: `/dashboard/reservations/${r.id}` };
        case 'check_in':
          await checkInGuest(r.id, actor, userId);
          return { success: true, message: `Reservation ${r.reference} marked as checked in.`, link: `/dashboard/reservations/${r.id}` };
        case 'check_out':
          await checkOutGuest(r.id, actor);
          return { success: true, message: `Reservation ${r.reference} marked as checked out.`, link: `/dashboard/reservations/${r.id}` };
        case 'cancel':
          await cancelReservation(r.id, reason || 'Cancelled by staff request', actor);
          return { success: true, message: `Reservation ${r.reference} cancelled.`, link: `/dashboard/reservations/${r.id}` };
        case 'reject':
          await rejectReservation(r.id, reason || 'Rejected by staff request', actor);
          return { success: true, message: `Reservation ${r.reference} rejected.`, link: `/dashboard/reservations/${r.id}` };
        case 'no_show':
          await markNoShow(r.id, actor);
          return { success: true, message: `Reservation ${r.reference} marked as no-show.`, link: `/dashboard/reservations/${r.id}` };
        default:
          return { error: `Unknown action '${action}'. Allowed: confirm, check_in, check_out, cancel, reject, no_show` };
      }
    }

    case 'record_payment': {
      const { reservationIdOrRef, amountEgp, method = 'cash', note, autoVerify = true } = args;
      const refOrId = String(reservationIdOrRef || '').trim();
      const rows = await q<any>('SELECT id, reference, total_cents FROM reservations WHERE reference ILIKE $1 OR id::text = $1', [refOrId]);
      if (!rows.length) return { error: `Reservation '${refOrId}' not found.` };
      const r = rows[0];

      const validMethod = METHODS.includes(method as PaymentMethod) ? (method as PaymentMethod) : 'cash';
      const amountCents = Math.round(Number(amountEgp) * 100);
      if (isNaN(amountCents) || amountCents <= 0) return { error: 'Invalid payment amount.' };

      // Cash / card at the desk go through the folio into the open POS drawer, exactly like the folio page.
      if (validMethod === 'cash' || validMethod === 'card_terminal') {
        const sh = await openShiftRow();
        if (validMethod === 'cash' && !sh) return { error: 'No POS shift is open. Cash must go into a drawer: open the POS shift first, then take the payment on the folio.', link: `/dashboard/folio/${r.id}` };
        await takeFolioPayment({ reservationId: r.id, amountCents, method: validMethod === 'cash' ? 'cash' : 'card', shiftId: sh?.id ?? null, staffId: sh?.staff_id ?? null, userId, note: note || 'Recorded by Dashboard AI Agent', actor });
        return { success: true, message: `Payment of ${amountEgp} EGP (${validMethod}) taken on the folio of ${r.reference}${sh ? ` and counted in shift #${sh.shift_no}` : ''}.`, link: `/dashboard/folio/${r.id}` };
      }
      // Transfers wait for a manager to see the money, like any other transfer.
      const p = await recordPayment(r.id, amountCents, validMethod, null, note || 'Recorded by Dashboard AI Agent', userId, actor);
      const canVerify = can(user.role, 'payment.verify');
      if (autoVerify && canVerify) await verifyPayment(p.id, true, userId, actor);
      return {
        success: true,
        message: `Transfer of ${amountEgp} EGP (${validMethod}) recorded for ${r.reference}${autoVerify && canVerify ? ' and verified' : ' — waiting for verification in Payments'}.`,
        paymentId: p.id,
        link: `/dashboard/reservations/${r.id}`,
      };
    }

    case 'add_reservation_note': {
      const { reservationIdOrRef, note } = args;
      const refOrId = String(reservationIdOrRef || '').trim();
      const rows = await q<any>('SELECT id, reference, staff_notes FROM reservations WHERE reference ILIKE $1 OR id::text = $1', [refOrId]);
      if (!rows.length) return { error: `Reservation '${refOrId}' not found.` };
      const r = rows[0];
      const updatedNotes = r.staff_notes ? `${r.staff_notes}\n[AI Note]: ${note}` : `[AI Note]: ${note}`;
      await q('UPDATE reservations SET staff_notes=$1, updated_at=now() WHERE id=$2', [updatedNotes, r.id]);
      return { success: true, message: `Note added to ${r.reference}.`, link: `/dashboard/reservations/${r.id}` };
    }

    case 'search_guests': {
      const query = String(args.query || '').trim();
      const guests = await q<any>(
        `SELECT g.*, count(r.id)::int total_stays
         FROM guests g
         LEFT JOIN reservations r ON r.guest_id=g.id
         WHERE lower(g.full_name) LIKE $1 OR coalesce(g.phone,'') LIKE $1 OR lower(coalesce(g.email,'')) LIKE $1
         GROUP BY g.id ORDER BY g.full_name LIMIT 10`,
        [`%${query.toLowerCase()}%`]
      );
      return guests.map((g: any) => ({
        id: g.id,
        name: g.full_name,
        phone: g.phone,
        email: g.email,
        nationality: g.nationality,
        totalStays: g.total_stays,
        link: `/dashboard/guests`,
      }));
    }

    case 'get_financial_report': {
      const from = args.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const to = args.to || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const rep = await reportData(from, to);
      return {
        period: `${from} to ${to}`,
        occupancyRate: `${rep.occupancy}%`,
        nightsSold: rep.sold,
        totalBookedEgp: Number(rep.money.booked) / 100,
        paymentsReceivedEgp: Number(rep.money.received) / 100,
        outstandingBalanceEgp: Number(rep.outstanding) / 100,
        bookingsBySource: rep.bySource,
        cancellations: rep.cancels,
      };
    }

    case 'get_inventory_status': {
      const prods = await getProducts(args.category);
      return prods.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        stockQuantity: p.track_stock ? p.stock_quantity : 'Unlimited (خدمة)',
        isLowStock: p.track_stock && p.stock_quantity <= p.low_stock_threshold,
        sellingPrice: `${p.price_cents / 100} ${p.currency}`,
        costPrice: `${p.cost_cents / 100} ${p.currency}`,
        profitMargin: `${(p.price_cents - p.cost_cents) / 100} ${p.currency}`,
      }));
    }

    case 'update_product_pricing': {
      const allProds = await getProducts();
      const qStr = String(args.productNameOrId || '').toLowerCase();
      const prod = allProds.find(p => p.id === args.productNameOrId || p.name.toLowerCase().includes(qStr));
      if (!prod) {
        return { error: `لم يتم العثور على صنف باسم "${args.productNameOrId}".` };
      }
      await updateProduct(prod.id, {
        costCents: args.costPrice !== undefined ? Math.round(Number(args.costPrice) * 100) : undefined,
        priceCents: args.sellingPrice !== undefined ? Math.round(Number(args.sellingPrice) * 100) : undefined,
        stockQuantity: args.stockQuantity !== undefined ? parseInt(String(args.stockQuantity), 10) : undefined,
      }, user.id);
      return {
        success: true,
        product: prod.name,
        newCost: args.costPrice !== undefined ? `${args.costPrice} EGP` : `${prod.cost_cents / 100} EGP`,
        newSellingPrice: args.sellingPrice !== undefined ? `${args.sellingPrice} EGP` : `${prod.price_cents / 100} EGP`,
        newStock: args.stockQuantity !== undefined ? args.stockQuantity : prod.stock_quantity,
        message: `تم تحديث أسعار/كمية الصنف "${prod.name}" بنجاح في الكتالوج.`,
      };
    }

    case 'create_new_product': {
      const p = await createProduct({
        name: args.name,
        category: args.category || 'other',
        priceCents: Math.round(Number(args.sellingPrice) * 100),
        costCents: args.costPrice ? Math.round(Number(args.costPrice) * 100) : 0,
        initialStock: args.initialStock || 0,
        trackStock: args.trackStock ?? true,
      });
      return {
        success: true,
        productId: p.id,
        name: p.name,
        sellingPrice: `${p.price_cents / 100} EGP`,
        costPrice: `${p.cost_cents / 100} EGP`,
        stock: p.stock_quantity,
        message: `تمت إضافة الصنف الجديد "${p.name}" بنجاح إلى الكتالوج والمخزن.`,
      };
    }

    case 'record_pos_sale':
    case 'record_petty_expense':
      // Sales and expenses only happen on the POS: it needs the cashier's PIN (and a manager PIN for expenses)
      // and puts the money in the right drawer, folio and stock. The assistant points there instead.
      return { error: 'Sales and expenses are recorded on the POS so the drawer, stock and folio stay in step.', link: '/pos' };

    case 'get_drawer_status': {
      const sh = await openShiftRow();
      if (!sh) return { status: 'No open shift', message: 'الدرج مغلق حالياً، لا توجد وردية مفتوحة.' };
      // The cashier closes blind, so what the drawer should hold is for managers only.
      if (!can(user.role, 'reports.view')) return { status: 'Open', shiftNo: sh.shift_no, cashier: sh.staff_name, message: 'The expected cash is shown to managers only (the close is a blind count).' };
      const t = await shiftTotals(sh.id);
      const c = t.currencies;
      return {
        status: 'Open', shiftNo: sh.shift_no, cashier: sh.staff_name, openedAt: sh.opened_at ?? sh.created_at,
        expectedInDrawer: { EGP: c.EGP.expected / 100, USD: c.USD.expected / 100, EUR: c.EUR.expected / 100 },
        cashSalesEgp: t.cashSales / 100, cardSalesEgp: t.cardSales / 100, roomChargesEgp: t.roomCharges / 100, folioCashEgp: t.roomCashPayments / 100,
        expensesEgp: t.expenses / 100, takenEgp: t.taken / 100, salesCount: t.salesCount,
        link: '/dashboard/shift-reports',
      };
    }

    case 'get_tours_schedule': {
      const tours = await toursList();
      return tours.map((t: any) => ({ guest: t.guest_name, room: t.room_number, tour: t.item_name, pax: t.quantity, date: t.order_date, status: t.payment_status }));
    }

    default:
      return { error: `Tool '${name}' not implemented.` };
  }
}

const ALL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_today_overview',
      description: 'Get today operations overview: arriving guests, departing guests, currently in-house guests, occupancy percentage, and free units tonight. ALWAYS call this when asked about today operations, arrivals, departures, or occupancy.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_in_house_guests',
      description: 'Get the list of all guests currently staying in the hostel (checked in), their room/bed assignments, stay dates, and balance. Call this when asked "who is in the hostel", "in-house guests", "مين ساكن/مقيم حالياً".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_unpaid_balances',
      description: 'List all reservations that have unpaid or partially paid balances (who owes money). Call this when asked about debts, balances, or who has not paid yet.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_reservations',
      description: 'Search or list reservations. IF NO QUERY IS PROVIDED, IT RETURNS THE MOST RECENT RESERVATIONS! Call this whenever asked to show bookings, search by guest name, phone, reference (VL-...), status, or date range.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search term: guest name, phone, reference, or email (leave empty to get recent bookings)' },
          status: { type: 'string', description: 'Filter by status: confirmed, pending, checked_in, checked_out, cancelled, rejected' },
          payment: { type: 'string', description: 'Filter by payment: unpaid, partial, paid' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD' },
          to: { type: 'string', description: 'End date YYYY-MM-DD' },
          limit: { type: 'integer', description: 'Max results to return, default 12' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reservation_details',
      description: 'Get comprehensive details of a single reservation by booking reference (e.g. VL-ABC123) or UUID.',
      parameters: {
        type: 'object',
        properties: {
          referenceOrId: { type: 'string', description: 'Booking reference or UUID' },
        },
        required: ['referenceOrId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_room_availability',
      description: 'Check available rooms/dorm beds and prices for specific dates and guest count.',
      parameters: {
        type: 'object',
        properties: {
          checkIn: { type: 'string', description: 'Check-in date YYYY-MM-DD' },
          checkOut: { type: 'string', description: 'Check-out date YYYY-MM-DD' },
          guestsCount: { type: 'integer', description: 'Number of guests' },
        },
        required: ['checkIn', 'checkOut'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reservation',
      description: 'Create a new reservation for a guest in the hostel management system.',
      parameters: {
        type: 'object',
        properties: {
          guestName: { type: 'string', description: 'Full name of guest' },
          phone: { type: 'string', description: 'Phone number or WhatsApp' },
          email: { type: 'string', description: 'Email address' },
          roomTypeCode: { type: 'string', description: 'Room type code (e.g. sheherazade, violet, mixed-dorm-10, male-dorm-8, female-dorm-8, ibn-battuta) or room name' },
          checkIn: { type: 'string', description: 'Arrival date YYYY-MM-DD' },
          checkOut: { type: 'string', description: 'Departure date YYYY-MM-DD' },
          guestsCount: { type: 'integer', description: 'Number of guests' },
          status: { type: 'string', enum: ['confirmed', 'pending'], description: 'Initial status, default confirmed' },
          notes: { type: 'string', description: 'Staff or guest notes' },
        },
        required: ['guestName', 'checkIn', 'checkOut'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_reservation_status',
      description: 'Update reservation status: confirm a request, check in an arrival, check out a stay, cancel, or reject a booking.',
      parameters: {
        type: 'object',
        properties: {
          reservationIdOrRef: { type: 'string', description: 'Booking reference or UUID' },
          action: { type: 'string', enum: ['confirm', 'check_in', 'check_out', 'cancel', 'reject', 'no_show'] },
          reason: { type: 'string', description: 'Reason for cancellation or rejection' },
        },
        required: ['reservationIdOrRef', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_payment',
      description: 'Record and verify a payment received from a guest for a reservation.',
      parameters: {
        type: 'object',
        properties: {
          reservationIdOrRef: { type: 'string', description: 'Booking reference or UUID' },
          amountEgp: { type: 'number', description: 'Amount in Egyptian Pounds (EGP)' },
          method: { type: 'string', enum: ['cash', 'instapay', 'bank_transfer', 'card_terminal', 'online_provider', 'other'] },
          note: { type: 'string', description: 'Payment receipt notes' },
        },
        required: ['reservationIdOrRef', 'amountEgp'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_reservation_note',
      description: 'Add an operational or special request note to an existing reservation.',
      parameters: {
        type: 'object',
        properties: {
          reservationIdOrRef: { type: 'string', description: 'Booking reference or UUID' },
          note: { type: 'string', description: 'Note text' },
        },
        required: ['reservationIdOrRef', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_guests',
      description: 'Search guests database by name, phone, or email to check stay history.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, phone, or email' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_financial_report',
      description: 'Get hostel financial revenue, nights sold, occupancy %, and payment breakdown for a date range.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date YYYY-MM-DD' },
          to: { type: 'string', description: 'End date YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_status',
      description: 'Check hostel mini-market stock levels, available quantities of water, soda, snacks, bath/pool towels, and low stock warnings.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional filter: beverage, snack, linen_towel, laundry, meal_breakfast, transport, activity_tour' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_drawer_status',
      description: 'Check the current cash drawer status: active shift, drawer cash in EGP, USD, and EUR, POS terminal total, and petty expenses.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tours_schedule',
      description: 'Tours sold on the POS for yesterday, today and tomorrow: guest, room, tour and number of people.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_product_pricing',
      description: 'Update the supply/cost price, selling price, or stock quantity of a product, market item, or service in the hostel catalog.',
      parameters: {
        type: 'object',
        properties: {
          productNameOrId: { type: 'string', description: 'Name or ID of the product/service (e.g. مياه صغيرة، كانز كولا، فوطة استحمام)' },
          costPrice: { type: 'number', description: 'New supply/cost price in EGP' },
          sellingPrice: { type: 'number', description: 'New selling price for guests in EGP' },
          stockQuantity: { type: 'integer', description: 'New stock quantity' },
        },
        required: ['productNameOrId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_new_product',
      description: 'Add a new item, beverage, snack, tour, or service to the hostel catalog/market.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the new item or service' },
          category: { type: 'string', enum: ['beverage', 'snack', 'linen_towel', 'laundry', 'meal_breakfast', 'activity_tour', 'transport', 'other'], description: 'Category' },
          costPrice: { type: 'number', description: 'Supply/cost price in EGP' },
          sellingPrice: { type: 'number', description: 'Selling price in EGP' },
          initialStock: { type: 'integer', description: 'Initial stock quantity' },
          trackStock: { type: 'boolean', description: 'True for physical goods/towels, false for pure services' },
        },
        required: ['name', 'sellingPrice'],
      },
    },
  },
];


/* ───────── Executive KPIs (read-only) ───────── */

const EXEC_DEFS: { name: string; description: string; properties?: Record<string, any> }[] = [
  { name: 'get_revenue', description: 'Money collected for a day or date range: POS sales paid on the spot, payments on guest folios, event tickets. Use for "today\'s revenue", "how much did we make".',
    properties: { from: { type: 'string', description: 'YYYY-MM-DD, default today' }, to: { type: 'string', description: 'YYYY-MM-DD, default = from' } } },
  { name: 'get_market_sales', description: 'POS sales by item and section (market, meals, services, tours) with gross profit, for a date range.',
    properties: { from: { type: 'string' }, to: { type: 'string' } } },
  { name: 'get_event_profit', description: 'Tickets sold, revenue and net profit per event or day-use package. Net profit = (price − cost per attendee) × tickets.',
    properties: { from: { type: 'string' }, to: { type: 'string' } } },
  { name: 'get_low_stock', description: 'Items at or below their low-stock alert level.' },
  { name: 'get_unpaid_in_house', description: 'In-house guests with an open folio balance who have been in house at least N days (default 1).',
    properties: { minDays: { type: 'number' } } },
  { name: 'get_shift_reports', description: 'POS shift summaries: cashier, expected vs counted cash, variance, sales, owner allowances.',
    properties: { from: { type: 'string' }, to: { type: 'string' } } },
  { name: 'get_attendance', description: 'Staff attendance for a month: target vs worked hours, lateness, deductions, and who was late today.',
    properties: { month: { type: 'string', description: 'YYYY-MM, default this month' } } },
];

const EXEC_TOOLS: Record<string, (a: any) => Promise<any>> = {
  get_revenue: (a) => insights.revenueSummary(a.from, a.to),
  get_market_sales: (a) => insights.marketSales(a.from, a.to),
  get_event_profit: (a) => insights.eventProfits(a.from, a.to),
  get_low_stock: () => insights.lowStock(),
  get_unpaid_in_house: (a) => insights.unpaidInHouse(Number.isFinite(Number(a.minDays)) ? Number(a.minDays) : 1),
  get_shift_reports: (a) => insights.shiftSummaries(a.from, a.to),
  get_attendance: (a) => insights.attendanceSummary(a.month),
};

export const DASHBOARD_TOOLS = [
  ...ALL_TOOLS.filter((t: any) => READ_ONLY_BASE.has(t.function.name)),
  ...EXEC_DEFS.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: { type: 'object', properties: d.properties ?? {} } } })),
];
