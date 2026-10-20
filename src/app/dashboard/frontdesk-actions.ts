'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import {
  createServiceOrder,
  createBatchServiceOrders,
  adjustStock,
  conductInventoryAudit,
  createProduct,
  updateProduct,
  deleteProduct,
  openShift,
  closeShift,
  markShiftTaken,
  recordCashExpense,
  createTourBooking,
  updateTourStatus,
  createTowelLoan,
  returnTowelLoan,
} from '@/services/frontdesk';

/* ───────── POS & SERVICE ORDERS ───────── */

export async function createBatchServiceOrdersAction(formData: FormData) {
  const u = await requireUser('pos.use');
  const cartJson = formData.get('cart') as string;
  const reservationId = (formData.get('reservationId') as string) || undefined;
  const guestName = (formData.get('guestName') as string)?.trim() || 'Guest';
  const roomNumber = (formData.get('roomNumber') as string)?.trim() || undefined;
  const paymentMethod = (formData.get('paymentMethod') as string) || 'cash';
  const paymentStatus = (formData.get('paymentStatus') as string) || 'paid';
  const comment = (formData.get('comment') as string)?.trim() || undefined;

  if (!cartJson) {
    redirect('/dashboard/pos?err=' + encodeURIComponent('Cart is empty'));
  }

  try {
    const items = JSON.parse(cartJson);
    if (!Array.isArray(items) || items.length === 0) {
      redirect('/dashboard/pos?err=' + encodeURIComponent('Cart is empty'));
    }

    const payload = items.map((it: any) => ({
      reservationId,
      guestName,
      roomNumber,
      serviceType: it.serviceType || 'other',
      productId: it.productId || undefined,
      quantity: Math.max(1, Number(it.quantity) || 1),
      amountCents: Math.round(Number(it.unitPrice) * (Number(it.quantity) || 1) * 100),
      currency: it.currency || 'EGP',
      paymentMethod,
      paymentStatus,
      staffId: u.id,
      staffName: u.name,
      comment: it.name ? `${it.name}${comment ? ' - ' + comment : ''}` : comment,
    }));

    await createBatchServiceOrders(payload);
  } catch (err: any) {
    redirect(`/dashboard/pos?err=${encodeURIComponent(err.message || 'Could not record orders')}`);
  }

  revalidatePath('/dashboard/pos');
  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/shifts');
  if (reservationId) revalidatePath(`/dashboard/reservations/${reservationId}`);
  redirect('/dashboard/pos?ok=' + encodeURIComponent('Order completed; all items recorded'));
}

export async function createServiceOrderAction(formData: FormData) {
  const u = await requireUser('pos.use');
  const reservationId = (formData.get('reservationId') as string) || undefined;
  const guestName = (formData.get('guestName') as string)?.trim() || 'Guest';
  const roomNumber = (formData.get('roomNumber') as string)?.trim() || undefined;
  const serviceType = (formData.get('serviceType') as string) || 'other';
  const productId = (formData.get('productId') as string) || undefined;
  const quantity = Math.max(1, parseInt((formData.get('quantity') as string) || '1', 10));
  const amount = parseFloat((formData.get('amount') as string) || '0');
  const currency = (formData.get('currency') as string) || 'EGP';
  const paymentMethod = (formData.get('paymentMethod') as string) || 'cash';
  const paymentStatus = (formData.get('paymentStatus') as string) || 'paid';
  const comment = (formData.get('comment') as string)?.trim() || undefined;

  try {
    await createServiceOrder({
      reservationId,
      guestName,
      roomNumber,
      serviceType,
      productId,
      quantity,
      amountCents: Math.round(amount * 100),
      currency,
      paymentMethod,
      paymentStatus,
      staffId: u.id,
      staffName: u.name,
      comment,
    });
  } catch (err: any) {
    redirect(`/dashboard/pos?err=${encodeURIComponent(err.message || 'Could not record order')}`);
  }

  revalidatePath('/dashboard/pos');
  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/shifts');
  if (reservationId) revalidatePath(`/dashboard/reservations/${reservationId}`);
  redirect('/dashboard/pos?ok=' + encodeURIComponent('Order recorded'));
}

/* ───────── INVENTORY & STOCK ───────── */

export async function createProductAction(formData: FormData) {
  const u = await requireUser('inventory.manage');
  const returnTo = (formData.get('returnTo') as string) || '/dashboard/inventory';
  const name = (formData.get('name') as string)?.trim();
  if (!name) redirect(`${returnTo}?err=` + encodeURIComponent('Item name is required'));

  const category = (formData.get('category') as string) || 'other';
  const price = parseFloat((formData.get('price') as string) || '0');
  const cost = parseFloat((formData.get('cost') as string) || '0');
  const initialStock = parseInt((formData.get('initialStock') as string) || '0', 10);
  const trackStock = formData.get('trackStock') === 'on' || formData.get('trackStock') === 'true';
  const lowStockThreshold = parseInt((formData.get('lowStockThreshold') as string) || '5', 10);

  try {
    await createProduct({
      name,
      category,
      priceCents: Math.round(price * 100),
      costCents: Math.round(cost * 100),
      initialStock,
      trackStock,
      lowStockThreshold,
    });
  } catch (err: any) {
    redirect(`${returnTo}?err=${encodeURIComponent(err.message || 'Could not add item')}`);
  }

  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/pos');
  redirect(`${returnTo}?ok=` + encodeURIComponent('Item added'));
}

export async function updateProductAction(formData: FormData) {
  const u = await requireUser('inventory.manage');
  const returnTo = (formData.get('returnTo') as string) || '/dashboard/inventory';
  const id = formData.get('id') as string;
  if (!id) redirect(`${returnTo}?err=` + encodeURIComponent('Item ID is missing'));

  const name = (formData.get('name') as string)?.trim();
  const category = (formData.get('category') as string) || undefined;
  const price = formData.get('price') ? parseFloat(formData.get('price') as string) : undefined;
  const cost = formData.get('cost') ? parseFloat(formData.get('cost') as string) : undefined;
  const stock = formData.get('stock') !== null ? parseInt(formData.get('stock') as string, 10) : undefined;
  const lowStock = formData.get('lowStock') !== null ? parseInt(formData.get('lowStock') as string, 10) : undefined;
  const trackStock = formData.get('trackStock') !== null ? (formData.get('trackStock') === 'on' || formData.get('trackStock') === 'true') : undefined;

  try {
    await updateProduct(
      id,
      {
        name,
        category,
        priceCents: price !== undefined ? Math.round(price * 100) : undefined,
        costCents: cost !== undefined ? Math.round(cost * 100) : undefined,
        stockQuantity: stock,
        lowStockThreshold: lowStock,
        trackStock,
      },
      u.id
    );
  } catch (err: any) {
    redirect(`${returnTo}?err=${encodeURIComponent(err.message || 'Could not update item')}`);
  }

  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/pos');
  redirect(`${returnTo}?ok=` + encodeURIComponent('Item and price updated'));
}

export async function deleteProductAction(formData: FormData) {
  const u = await requireUser('inventory.manage');
  const returnTo = (formData.get('returnTo') as string) || '/dashboard/inventory';
  const id = formData.get('id') as string;
  if (!id) redirect(`${returnTo}?err=` + encodeURIComponent('Item ID is missing'));

  try {
    await deleteProduct(id);
  } catch (err: any) {
    redirect(`${returnTo}?err=${encodeURIComponent(err.message || 'Could not delete item')}`);
  }

  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/pos');
  redirect(`${returnTo}?ok=` + encodeURIComponent('Item removed from the menu'));
}

export async function adjustStockAction(formData: FormData) {
  const u = await requireUser('inventory.manage');
  const productId = formData.get('productId') as string;
  const qty = parseInt((formData.get('quantity') as string) || '0', 10);
  const type = (formData.get('type') as string) || 'purchase';
  const note = (formData.get('note') as string)?.trim() || undefined;

  if (!productId || qty === 0) {
    redirect('/dashboard/inventory?err=' + encodeURIComponent('Invalid stock adjustment'));
  }

  try {
    await adjustStock(productId, qty, type, note, u.id);
  } catch (err: any) {
    redirect(`/dashboard/inventory?err=${encodeURIComponent(err.message || 'Could not adjust stock')}`);
  }

  revalidatePath('/dashboard/inventory');
  redirect('/dashboard/inventory?ok=' + encodeURIComponent('Stock updated and movement logged'));
}

export async function auditStockAction(formData: FormData) {
  const u = await requireUser('inventory.manage');
  const auditJson = formData.get('auditData') as string;
  const note = (formData.get('note') as string)?.trim() || undefined;

  if (!auditJson) {
    redirect('/dashboard/inventory?err=' + encodeURIComponent('No stock count data'));
  }

  try {
    const parsed = JSON.parse(auditJson);
    await conductInventoryAudit(parsed, note, u.id);
  } catch (err: any) {
    redirect(`/dashboard/inventory?err=${encodeURIComponent(err.message || 'Could not approve stock count')}`);
  }

  revalidatePath('/dashboard/inventory');
  redirect('/dashboard/inventory?ok=' + encodeURIComponent('Stock count saved; variances reconciled'));
}

/* ───────── CASH SHIFTS & DRAWER ───────── */

export async function openShiftAction(formData: FormData) {
  const u = await requireUser('shifts.manage');
  const shiftName = (formData.get('shiftName') as string) || 'Morning';
  const startEgp = parseFloat((formData.get('startEgp') as string) || '0');
  const startUsd = parseFloat((formData.get('startUsd') as string) || '0');
  const startEur = parseFloat((formData.get('startEur') as string) || '0');
  const notes = (formData.get('notes') as string)?.trim() || undefined;

  try {
    await openShift({
      shiftName,
      userId: u.id,
      startEgp: Math.round(startEgp * 100),
      startUsd,
      startEur,
      notes,
    });
  } catch (err: any) {
    redirect(`/dashboard/shifts?err=${encodeURIComponent(err.message || 'Could not open shift')}`);
  }

  revalidatePath('/dashboard/shifts');
  redirect('/dashboard/shifts?ok=' + encodeURIComponent('Shift opened'));
}

export async function closeShiftAction(formData: FormData) {
  const u = await requireUser('shifts.manage');
  const shiftId = formData.get('shiftId') as string;
  const actualEgp = parseFloat((formData.get('actualEgp') as string) || '0');
  const actualUsd = parseFloat((formData.get('actualUsd') as string) || '0');
  const actualEur = parseFloat((formData.get('actualEur') as string) || '0');
  const actualPos = parseFloat((formData.get('actualPos') as string) || '0');
  const notes = (formData.get('notes') as string)?.trim() || undefined;

  try {
    await closeShift(shiftId, {
      userId: u.id,
      actualEgp: Math.round(actualEgp * 100),
      actualUsd,
      actualEur,
      actualPos: Math.round(actualPos * 100),
      notes,
    });
  } catch (err: any) {
    redirect(`/dashboard/shifts?err=${encodeURIComponent(err.message || 'Could not close shift')}`);
  }

  revalidatePath('/dashboard/shifts');
  redirect('/dashboard/shifts?ok=' + encodeURIComponent('Shift closed and reconciled'));
}

export async function takeShiftAction(formData: FormData) {
  const u = await requireUser('shifts.take');
  const shiftId = formData.get('shiftId') as string;

  try {
    await markShiftTaken(shiftId, u.id);
  } catch (err: any) {
    redirect(`/dashboard/shifts?err=${encodeURIComponent(err.message || 'Could not record cash handover')}`);
  }

  revalidatePath('/dashboard/shifts');
  redirect('/dashboard/shifts?ok=' + encodeURIComponent('Cash handover to safe approved'));
}

export async function recordExpenseAction(formData: FormData) {
  const u = await requireUser('shifts.manage');
  const shiftId = (formData.get('shiftId') as string) || undefined;
  const category = (formData.get('category') as string) || 'supplies';
  const amount = parseFloat((formData.get('amount') as string) || '0');
  const currency = (formData.get('currency') as string) || 'EGP';
  const description = (formData.get('description') as string)?.trim();

  if (!description || amount <= 0) {
    redirect('/dashboard/shifts?err=' + encodeURIComponent('Enter an amount and a description for the expense'));
  }

  try {
    await recordCashExpense({
      shiftId,
      category,
      amountCents: Math.round(amount * 100),
      currency,
      description,
      userId: u.id,
    });
  } catch (err: any) {
    redirect(`/dashboard/shifts?err=${encodeURIComponent(err.message || 'Could not record expense')}`);
  }

  revalidatePath('/dashboard/shifts');
  redirect('/dashboard/shifts?ok=' + encodeURIComponent('Expense recorded and deducted from the cash drawer'));
}

/* ───────── TOURS & TRANSFERS ───────── */

export async function createTourAction(formData: FormData) {
  const u = await requireUser('tours.manage');
  const reservationId = (formData.get('reservationId') as string) || undefined;
  const guestName = (formData.get('guestName') as string)?.trim() || 'Guest';
  const roomNumber = (formData.get('roomNumber') as string)?.trim() || undefined;
  const destination = (formData.get('destination') as string)?.trim();
  const tourDate = (formData.get('tourDate') as string);
  const pickupTime = (formData.get('pickupTime') as string) || '07:00';
  const guestsCount = parseInt((formData.get('guestsCount') as string) || '1', 10);
  const guideName = (formData.get('guideName') as string)?.trim() || undefined;
  const driverName = (formData.get('driverName') as string)?.trim() || undefined;
  const driverPhone = (formData.get('driverPhone') as string)?.trim() || undefined;
  const price = parseFloat((formData.get('price') as string) || '0');
  const currency = (formData.get('currency') as string) || 'EGP';
  const paymentStatus = (formData.get('paymentStatus') as string) || 'unpaid';
  const notes = (formData.get('notes') as string)?.trim() || undefined;

  if (!destination || !tourDate) {
    redirect('/dashboard/tours?err=' + encodeURIComponent('Tour destination and date are required'));
  }

  try {
    await createTourBooking({
      reservationId,
      guestName,
      roomNumber,
      destination,
      tourDate,
      pickupTime,
      guestsCount,
      guideName,
      driverName,
      driverPhone,
      priceCents: Math.round(price * 100),
      currency,
      paymentStatus,
      userId: u.id,
      notes,
    });
  } catch (err: any) {
    redirect(`/dashboard/tours?err=${encodeURIComponent(err.message || 'Could not book tour')}`);
  }

  revalidatePath('/dashboard/tours');
  redirect('/dashboard/tours?ok=' + encodeURIComponent('Tour booking recorded'));
}

export async function updateTourStatusAction(formData: FormData) {
  const u = await requireUser('tours.manage');
  const tourId = formData.get('tourId') as string;
  const status = formData.get('status') as string;

  try {
    await updateTourStatus(tourId, status);
  } catch (err: any) {
    redirect(`/dashboard/tours?err=${encodeURIComponent(err.message || 'Could not update status')}`);
  }

  revalidatePath('/dashboard/tours');
  redirect('/dashboard/tours?ok=' + encodeURIComponent('Tour status updated'));
}

/* ───────── TOWEL & LINEN TRACKING ───────── */

export async function createTowelLoanAction(formData: FormData) {
  const u = await requireUser('inventory.manage');
  const reservationId = (formData.get('reservationId') as string) || undefined;
  const guestName = (formData.get('guestName') as string)?.trim() || 'Guest';
  const roomNumber = (formData.get('roomNumber') as string)?.trim() || undefined;
  const quantity = Math.max(1, parseInt((formData.get('quantity') as string) || '1', 10));
  const towelType = (formData.get('towelType') as string) || 'bath_towel';
  const deposit = parseFloat((formData.get('deposit') as string) || '0');
  const depositStatus = (formData.get('depositStatus') as string) || (deposit > 0 ? 'paid' : 'none');
  const notes = (formData.get('notes') as string)?.trim() || undefined;

  try {
    await createTowelLoan({
      reservationId,
      guestName,
      roomNumber,
      quantity,
      towelType,
      depositCents: Math.round(deposit * 100),
      depositStatus,
      userId: u.id,
      notes,
    });
  } catch (err: any) {
    redirect(`/dashboard/inventory?err=${encodeURIComponent(err.message || 'Could not record towel issue')}`);
  }

  revalidatePath('/dashboard/inventory');
  redirect('/dashboard/inventory?ok=' + encodeURIComponent('Towel issued to guest'));
}

export async function returnTowelAction(formData: FormData) {
  const u = await requireUser('inventory.manage');
  const loanId = formData.get('loanId') as string;
  const depositAction = (formData.get('depositAction') as any) || 'none';

  try {
    await returnTowelLoan(loanId, depositAction);
  } catch (err: any) {
    redirect(`/dashboard/inventory?err=${encodeURIComponent(err.message || 'Could not confirm towel return')}`);
  }

  revalidatePath('/dashboard/inventory');
  redirect('/dashboard/inventory?ok=' + encodeURIComponent('Towel returned to stock'));
}
