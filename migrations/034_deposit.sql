-- Website room bookings: only the deposit is paid online (Paymob); the rest is collected at the hotel.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deposit_cents bigint;
