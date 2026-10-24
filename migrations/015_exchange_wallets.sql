-- Wallet receipts on room bookings can be Vodafone Cash too.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash','bank_transfer','instapay','vodafone_cash','card_terminal','online_provider','other','channel_prepaid'));

-- Money exchange at the desk: the guest gives USD / EUR, the drawer pays out EGP. Not revenue; moves drawer money.
CREATE TABLE IF NOT EXISTS cash_exchanges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      uuid NOT NULL REFERENCES cash_shifts(id),
  staff_id      uuid REFERENCES staff(id),
  currency      text NOT NULL CHECK (currency IN ('USD','EUR')),
  foreign_minor bigint NOT NULL CHECK (foreign_minor > 0),
  rate          numeric(10,4) NOT NULL CHECK (rate > 0),
  egp_cents     bigint NOT NULL CHECK (egp_cents > 0),
  guest         text,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_exchanges_shift ON cash_exchanges(shift_id);
