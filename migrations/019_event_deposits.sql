-- Events: an optional deposit paid online (InstaPay / Vodafone Cash), the rest at the villa on the POS.
ALTER TABLE events ADD COLUMN IF NOT EXISTS deposit_cents bigint CHECK (deposit_cents IS NULL OR deposit_cents > 0);
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS deposit_cents bigint;                    -- asked online (per booking)
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS paid_cents bigint NOT NULL DEFAULT 0;     -- received so far (online + POS)
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS pos_cents bigint NOT NULL DEFAULT 0;      -- part taken on the POS
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS pos_method text CHECK (pos_method IS NULL OR pos_method IN ('cash','card'));
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS pos_paid_at timestamptz;
UPDATE event_bookings SET paid_cents = total_cents WHERE status='paid' AND paid_cents = 0;
UPDATE event_bookings SET pos_cents = total_cents, pos_method = pay_method, pos_paid_at = paid_at
  WHERE status='paid' AND shift_id IS NOT NULL AND pay_method IN ('cash','card') AND pos_cents = 0;
