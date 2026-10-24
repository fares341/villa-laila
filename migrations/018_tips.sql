-- Tips given by guests on top of what they pay (cash in any currency, or on the card machine). Not hostel revenue.
CREATE TABLE IF NOT EXISTS cash_tips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id         uuid NOT NULL REFERENCES cash_shifts(id),
  staff_id         uuid REFERENCES staff(id),
  method           text NOT NULL CHECK (method IN ('cash','card')),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  minor            bigint NOT NULL CHECK (minor > 0),
  egp_cents        bigint NOT NULL CHECK (egp_cents >= 0),
  sale_id          uuid,
  payment_id       uuid,
  event_booking_id uuid,
  guest            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_tips_shift ON cash_tips(shift_id);
