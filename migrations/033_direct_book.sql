-- Prices read from the hostel's own booking engine (direct-book.com, Little Hotelier), per room and night.
CREATE TABLE IF NOT EXISTS direct_prices (
  stay_date date NOT NULL,
  room_code text NOT NULL,          -- our room_types.code
  room_name text NOT NULL,          -- the name on direct-book
  available boolean NOT NULL,
  price_cents bigint,               -- per bed (dorm) or per room (private), one night
  currency text NOT NULL DEFAULT 'USD',
  rate_name text,
  cancellation text,
  deposit text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stay_date, room_code)
);
-- The booking form asks for the same details as the booking engine.
ALTER TABLE guests ADD COLUMN IF NOT EXISTS address jsonb;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS arrival_time text;
