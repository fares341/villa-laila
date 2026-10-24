-- No channel manager: bookings from Booking.com, Airbnb, Hostelworld and Expedia are typed in by reception,
-- each in its own section. Money the guest already paid to the site is recorded on the folio as "channel_prepaid"
-- (never in a drawer); whatever is left is collected at the hostel through the POS.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_source_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('website','telegram','staff','import','walk_in','channel','booking_com','airbnb','hostelworld','expedia'));
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS channel_ref text;                -- the site's confirmation number
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS channel_collect text
  CHECK (channel_collect IS NULL OR channel_collect IN ('property','channel','deposit')); -- who takes the guest's money
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS channel_commission_cents bigint;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS channel_prepaid_cents bigint;
CREATE UNIQUE INDEX IF NOT EXISTS reservations_channel_ref_uq ON reservations(source, channel_ref) WHERE channel_ref IS NOT NULL;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash','bank_transfer','instapay','card_terminal','online_provider','other','channel_prepaid'));
