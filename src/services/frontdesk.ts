import { q, pool } from '@/lib/db';

export interface ProductItem {
  id: string;
  name: string;
  category: string;
  price_cents: number;
  currency: string;
  cost_cents: number;
  stock_quantity: number;
  track_stock: boolean;
  low_stock_threshold: number;
  is_active: boolean;
  created_at: string;
}

export interface ServiceOrderRow {
  id: string;
  order_number: string;
  order_date: string;
  reservation_id?: string;
  guest_name: string;
  room_number?: string;
  service_type: string;
  product_id?: string;
  product_name?: string;
  quantity: number;
  amount_cents: number;
  currency: string;
  payment_method?: string;
  payment_status: string;
  staff_name?: string;
  comment?: string;
  created_at: string;
}

/* ───────── PRODUCTS & INVENTORY ───────── */

export async function getProducts(category?: string): Promise<ProductItem[]> {
  const where = category ? 'WHERE is_active AND category = $1' : 'WHERE is_active';
  const params = category ? [category] : [];
  return q<ProductItem>(
    `SELECT * FROM products ${where} ORDER BY category, name ASC`,
    params
  );
}

export async function createProduct(data: {
  name: string;
  category: string;
  priceCents: number;
  currency?: string;
  costCents?: number;
  initialStock?: number;
  trackStock?: boolean;
  lowStockThreshold?: number;
}) {
  const cur = data.currency || 'EGP';
  const track = data.trackStock ?? true;
  const rows = await q<ProductItem>(
    `INSERT INTO products (name, category, price_cents, currency, cost_cents, stock_quantity, track_stock, low_stock_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      data.name,
      data.category,
      data.priceCents,
      cur,
      data.costCents || 0,
      data.initialStock || 0,
      track,
      data.lowStockThreshold || 5,
    ]
  );
  return rows[0];
}

export async function updateProduct(
  id: string,
  data: {
    name?: string;
    category?: string;
    priceCents?: number;
    costCents?: number;
    stockQuantity?: number;
    lowStockThreshold?: number;
    trackStock?: boolean;
    isActive?: boolean;
  },
  userId?: string
) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!pRes.rows.length) throw new Error('Product not found');
    const prev = pRes.rows[0];

    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
    if (data.category !== undefined) { sets.push(`category = $${idx++}`); params.push(data.category); }
    if (data.priceCents !== undefined) { sets.push(`price_cents = $${idx++}`); params.push(data.priceCents); }
    if (data.costCents !== undefined) { sets.push(`cost_cents = $${idx++}`); params.push(data.costCents); }
    if (data.lowStockThreshold !== undefined) { sets.push(`low_stock_threshold = $${idx++}`); params.push(data.lowStockThreshold); }
    if (data.trackStock !== undefined) { sets.push(`track_stock = $${idx++}`); params.push(data.trackStock); }
    if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }

    if (data.stockQuantity !== undefined) {
      sets.push(`stock_quantity = $${idx++}`);
      params.push(data.stockQuantity);

      const diff = data.stockQuantity - prev.stock_quantity;
      if (diff !== 0) {
        await client.query(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference, note, created_by)
           VALUES ($1, 'adjustment_audit', $2, $3, $4, $5, $6, $7)`,
          [id, diff, prev.stock_quantity, data.stockQuantity, 'MANUAL-EDIT', `تعديل يدوي للرصيد من لوحة الأسعار (${diff > 0 ? '+' : ''}${diff})`, userId || null]
        );
      }
    }

    if (sets.length) {
      await client.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $1`, params);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteProduct(id: string) {
  await q('UPDATE products SET is_active = false WHERE id = $1', [id]);
}

export async function adjustStock(
  productId: string,
  quantityChange: number,
  movementType: string,
  note?: string,
  userId?: string,
  reference?: string
) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const pRes = await client.query('SELECT stock_quantity, track_stock FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (!pRes.rows.length) throw new Error('Product not found');
    const currentStock = pRes.rows[0].stock_quantity;
    const newStock = Math.max(0, currentStock + quantityChange);

    await client.query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [newStock, productId]);

    await client.query(
      `INSERT INTO inventory_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [productId, movementType, quantityChange, currentStock, newStock, reference || null, note || null, userId || null]
    );

    await client.query('COMMIT');
    return { productId, previousStock: currentStock, newStock, quantityChange };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Conducts full inventory count / audit and reconciles discrepancies */
export async function conductInventoryAudit(
  audits: { productId: string; physicalCount: number }[],
  note?: string,
  userId?: string
) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const results = [];
    const ref = `AUDIT-${new Date().toISOString().slice(0, 10)}`;

    for (const item of audits) {
      const pRes = await client.query('SELECT name, stock_quantity FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
      if (!pRes.rows.length) continue;
      const prev = pRes.rows[0].stock_quantity;
      const count = Math.max(0, item.physicalCount);
      const diff = count - prev;

      if (diff !== 0) {
        await client.query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [count, item.productId]);
        await client.query(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference, note, created_by)
           VALUES ($1, 'adjustment_audit', $2, $3, $4, $5, $6, $7)`,
          [item.productId, diff, prev, count, ref, note || `تسوية جرد دوري (الفارق: ${diff > 0 ? '+' : ''}${diff})`, userId || null]
        );
      }
      results.push({ productId: item.productId, name: pRes.rows[0].name, prev, actual: count, diff });
    }

    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ───────── FRONT DESK SERVICE ORDERS (POS / LOG) ───────── */

export async function getServiceOrders(filters: {
  date?: string;
  from?: string;
  to?: string;
  service?: string;
  status?: string;
  search?: string;
  limit?: number;
}): Promise<ServiceOrderRow[]> {
  const clauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (filters.date) {
    clauses.push(`so.order_date = $${idx++}`);
    params.push(filters.date);
  } else {
    if (filters.from) {
      clauses.push(`so.order_date >= $${idx++}`);
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push(`so.order_date <= $${idx++}`);
      params.push(filters.to);
    }
  }

  if (filters.service) {
    clauses.push(`so.service_type = $${idx++}`);
    params.push(filters.service);
  }
  if (filters.status) {
    clauses.push(`so.payment_status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.search) {
    clauses.push(`(so.guest_name ILIKE $${idx} OR so.room_number ILIKE $${idx} OR so.order_number ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filters.limit || 100;
  params.push(limit);

  return q<ServiceOrderRow>(
    `SELECT so.*, p.name as product_name
     FROM service_orders so
     LEFT JOIN products p ON p.id = so.product_id
     ${where}
     ORDER BY so.created_at DESC
     LIMIT $${idx}`,
    params
  );
}

export async function createServiceOrder(data: {
  reservationId?: string;
  guestName: string;
  roomNumber?: string;
  serviceType: string;
  productId?: string;
  quantity?: number;
  amountCents: number;
  currency?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  staffId?: string;
  staffName?: string;
  comment?: string;
}) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const orderNum = `SO-${Math.floor(100000 + Math.random() * 900000)}`;
    const qty = data.quantity || 1;
    const cur = data.currency || 'EGP';
    const status = data.paymentStatus || 'paid';
    const method = data.paymentMethod || 'cash';

    // If product is linked and inventory is tracked, deduct stock
    if (data.productId) {
      const pRes = await client.query('SELECT stock_quantity, track_stock, name FROM products WHERE id = $1 FOR UPDATE', [data.productId]);
      if (pRes.rows.length && pRes.rows[0].track_stock) {
        const prev = pRes.rows[0].stock_quantity;
        const newStock = Math.max(0, prev - qty);
        await client.query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [newStock, data.productId]);
        await client.query(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity, previous_stock, new_stock, reference, note, created_by)
           VALUES ($1, 'sale', $2, $3, $4, $5, $6, $7)`,
          [data.productId, -qty, prev, newStock, orderNum, `طلب خدمة ${data.serviceType} لـ ${data.guestName}`, data.staffId || null]
        );
      }
    }

    const ins = await client.query(
      `INSERT INTO service_orders
       (order_number, reservation_id, guest_name, room_number, service_type, product_id, quantity, amount_cents, currency, payment_method, payment_status, staff_id, staff_name, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        orderNum,
        data.reservationId || null,
        data.guestName,
        data.roomNumber || null,
        data.serviceType,
        data.productId || null,
        qty,
        data.amountCents,
        cur,
        method,
        status,
        data.staffId || null,
        data.staffName || null,
        data.comment || null,
      ]
    );

    await client.query('COMMIT');
    return ins.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createBatchServiceOrders(items: Array<{
  reservationId?: string;
  guestName: string;
  roomNumber?: string;
  serviceType: string;
  productId?: string;
  quantity?: number;
  amountCents: number;
  currency?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  staffId?: string;
  staffName?: string;
  comment?: string;
}>) {
  const results = [];
  for (const item of items) {
    const res = await createServiceOrder(item);
    results.push(res);
  }
  return results;
}

/* ───────── CASH SHIFTS & DRAWER RECONCILIATION ───────── */

export async function getActiveShift() {
  const rows = await q<any>(
    `SELECT cs.*, u1.name as opener_name, u2.name as closer_name
     FROM cash_shifts cs
     LEFT JOIN users u1 ON u1.id = cs.opened_by
     LEFT JOIN users u2 ON u2.id = cs.closed_by
     WHERE cs.status = 'open'
     ORDER BY cs.created_at DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

export async function openShift(data: {
  shiftName?: string;
  userId: string;
  startEgp?: number;
  startUsd?: number;
  startEur?: number;
  notes?: string;
}) {
  const active = await getActiveShift();
  if (active) throw new Error('توجد وردية مفتوحة بالفعل. يرجى إغلاقها أولاً قبل فتح وردية جديدة.');

  const rows = await q<any>(
    `INSERT INTO cash_shifts (shift_name, opened_by, drawer_egp_start, drawer_usd_start, drawer_eur_start, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      data.shiftName || 'Morning',
      data.userId,
      data.startEgp || 0,
      data.startUsd || 0,
      data.startEur || 0,
      data.notes || null,
    ]
  );
  return rows[0];
}

export async function closeShift(
  shiftId: string,
  data: {
    userId: string;
    actualEgp: number;
    actualUsd: number;
    actualEur: number;
    actualPos: number;
    notes?: string;
  }
) {
  const rows = await q<any>(
    `UPDATE cash_shifts
     SET closed_by = $1, drawer_egp_actual = $2, drawer_usd_actual = $3, drawer_eur_actual = $4,
         pos_terminal_actual = $5, status = 'closed', notes = COALESCE(notes || E'\\n', '') || $6
     WHERE id = $7 RETURNING *`,
    [
      data.userId,
      data.actualEgp,
      data.actualUsd,
      data.actualEur,
      data.actualPos,
      data.notes ? `إغلاق: ${data.notes}` : '',
      shiftId,
    ]
  );
  return rows[0];
}

export async function markShiftTaken(shiftId: string, userId: string) {
  const rows = await q<any>(
    `UPDATE cash_shifts
     SET status = 'taken', taken_at = now(), taken_by = $1
     WHERE id = $2 RETURNING *`,
    [userId, shiftId]
  );
  return rows[0];
}

export async function getShiftsHistory(limit = 30) {
  return q<any>(
    `SELECT cs.*, u1.name as opener_name, u2.name as closer_name, u3.name as taken_by_name,
       (SELECT COALESCE(SUM(amount_cents), 0) FROM cash_expenses ce WHERE ce.shift_id = cs.id) as expenses_cents
     FROM cash_shifts cs
     LEFT JOIN users u1 ON u1.id = cs.opened_by
     LEFT JOIN users u2 ON u2.id = cs.closed_by
     LEFT JOIN users u3 ON u3.id = cs.taken_by
     ORDER BY cs.shift_date DESC, cs.created_at DESC
     LIMIT $1`,
    [limit]
  );
}

export async function recordCashExpense(data: {
  shiftId?: string;
  category: string;
  amountCents: number;
  currency?: string;
  description: string;
  userId: string;
}) {
  const rows = await q<any>(
    `INSERT INTO cash_expenses (shift_id, category, amount_cents, currency, description, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      data.shiftId || null,
      data.category,
      data.amountCents,
      data.currency || 'EGP',
      data.description,
      data.userId,
    ]
  );
  return rows[0];
}

export async function getExpensesList(filters: { shiftId?: string; date?: string; limit?: number }) {
  const clauses = [];
  const params: any[] = [];
  let i = 1;
  if (filters.shiftId) {
    clauses.push(`ce.shift_id = $${i++}`);
    params.push(filters.shiftId);
  }
  if (filters.date) {
    clauses.push(`ce.date = $${i++}`);
    params.push(filters.date);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(filters.limit || 50);

  return q<any>(
    `SELECT ce.*, u.name as recorder_name
     FROM cash_expenses ce
     LEFT JOIN users u ON u.id = ce.recorded_by
     ${where}
     ORDER BY ce.created_at DESC
     LIMIT $${i}`,
    params
  );
}

/* ───────── TOURS & TRAVEL DESK ───────── */

export async function getTourBookings(filters?: { from?: string; to?: string; status?: string }) {
  const clauses = [];
  const params: any[] = [];
  let i = 1;
  if (filters?.from) {
    clauses.push(`tb.tour_date >= $${i++}`);
    params.push(filters.from);
  }
  if (filters?.to) {
    clauses.push(`tb.tour_date <= $${i++}`);
    params.push(filters.to);
  }
  if (filters?.status) {
    clauses.push(`tb.status = $${i++}`);
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return q<any>(
    `SELECT tb.*, u.name as booker_name
     FROM tour_bookings tb
     LEFT JOIN users u ON u.id = tb.booked_by
     ${where}
     ORDER BY tb.tour_date ASC, tb.pickup_time ASC`,
    params
  );
}

export async function createTourBooking(data: {
  reservationId?: string;
  guestName: string;
  roomNumber?: string;
  destination: string;
  tourDate: string;
  pickupTime?: string;
  guestsCount?: number;
  guideName?: string;
  driverName?: string;
  driverPhone?: string;
  priceCents: number;
  currency?: string;
  costCents?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  userId?: string;
  notes?: string;
}) {
  const bookingNum = `TR-${Math.floor(1000 + Math.random() * 9000)}`;
  const rows = await q<any>(
    `INSERT INTO tour_bookings
     (booking_number, reservation_id, guest_name, room_number, destination, tour_date, pickup_time, guests_count, guide_name, driver_name, driver_phone, price_cents, currency, cost_cents, payment_status, payment_method, booked_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      bookingNum,
      data.reservationId || null,
      data.guestName,
      data.roomNumber || null,
      data.destination,
      data.tourDate,
      data.pickupTime || '07:00',
      data.guestsCount || 1,
      data.guideName || null,
      data.driverName || null,
      data.driverPhone || null,
      data.priceCents,
      data.currency || 'EGP',
      data.costCents || 0,
      data.paymentStatus || 'unpaid',
      data.paymentMethod || 'cash',
      data.userId || null,
      data.notes || null,
    ]
  );
  return rows[0];
}

export async function updateTourStatus(id: string, status: string) {
  const rows = await q<any>(
    `UPDATE tour_bookings SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0];
}

/* ───────── TOWEL & LINEN LOANS ───────── */

export async function getTowelLoans(returned?: boolean) {
  const where = returned !== undefined ? 'WHERE tl.returned = $1' : '';
  const params = returned !== undefined ? [returned] : [];
  return q<any>(
    `SELECT tl.*, u.name as loaner_name
     FROM towel_loans tl
     LEFT JOIN users u ON u.id = tl.loaned_by
     ${where}
     ORDER BY tl.loaned_at DESC`,
    params
  );
}

export async function createTowelLoan(data: {
  reservationId?: string;
  guestName: string;
  roomNumber?: string;
  quantity?: number;
  towelType?: string;
  depositCents?: number;
  depositCurrency?: string;
  depositStatus?: string;
  userId?: string;
  notes?: string;
}) {
  const rows = await q<any>(
    `INSERT INTO towel_loans
     (reservation_id, guest_name, room_number, quantity, towel_type, deposit_cents, deposit_currency, deposit_status, loaned_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.reservationId || null,
      data.guestName,
      data.roomNumber || null,
      data.quantity || 1,
      data.towelType || 'bath_towel',
      data.depositCents || 0,
      data.depositCurrency || 'EGP',
      data.depositStatus || 'none',
      data.userId || null,
      data.notes || null,
    ]
  );
  return rows[0];
}

export async function returnTowelLoan(loanId: string, depositAction: 'refund' | 'forfeit' | 'none') {
  const status = depositAction === 'refund' ? 'refunded' : depositAction === 'forfeit' ? 'forfeited' : 'none';
  const rows = await q<any>(
    `UPDATE towel_loans
     SET returned = true, returned_at = now(), deposit_status = $1
     WHERE id = $2 RETURNING *`,
    [status, loanId]
  );
  return rows[0];
}

/* ───────── DAILY REVENUE & SERVICES MATRIX BREAKDOWN ───────── */

export async function getDailyServicesMatrix(from: string, to: string) {
  const rows = await q<any>(
    `SELECT
       order_date,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'breakfast'), 0)::bigint as breakfast_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'towel'), 0)::bigint as towel_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'taxi'), 0)::bigint as taxi_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'pool'), 0)::bigint as pool_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'laundry'), 0)::bigint as laundry_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'water'), 0)::bigint as water_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type IN ('drinks', 'snack')), 0)::bigint as drinks_snack_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'tour'), 0)::bigint as tour_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'meal'), 0)::bigint as meal_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE service_type = 'extra_bed'), 0)::bigint as extra_bed_cents,
       COALESCE(SUM(amount_cents), 0)::bigint as total_daily_cents
     FROM service_orders
     WHERE order_date >= $1 AND order_date <= $2
     GROUP BY order_date
     ORDER BY order_date DESC`,
    [from, to]
  );

  return rows;
}
