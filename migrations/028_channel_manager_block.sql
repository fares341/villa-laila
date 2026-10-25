-- Bookings that did not come through the channel manager (website, walk-in, phone/WhatsApp) must be blocked there
-- by hand so the booking sites don't sell the same bed. The dashboard shows each one until reception ticks it.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cm_done_at timestamptz;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cm_done_by text;
-- Start clean: everything that exists today is considered handled.
UPDATE reservations SET cm_done_at = now(), cm_done_by = 'migration' WHERE cm_done_at IS NULL;
-- A blocked booking that is cancelled later: the block must be removed again (open the dates for sale).
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cm_released_at timestamptz;
