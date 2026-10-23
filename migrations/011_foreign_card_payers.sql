-- Card payments on the venue's card machine by foreign guests: passport number, name and nationality are kept
-- with the amount, and a daily Excel of them is sent at midnight (Cairo).
CREATE TABLE IF NOT EXISTS card_foreign_payers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  day             date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Cairo')::date),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  currency        text NOT NULL DEFAULT 'EGP',
  full_name       text NOT NULL,
  nationality     text NOT NULL,
  passport_no     text NOT NULL,
  source          text NOT NULL CHECK (source IN ('pos_sale','folio_payment')),
  sale_id         uuid,
  payment_id      uuid,
  reservation_id  uuid REFERENCES reservations(id),
  shift_id        uuid,
  staff_name      text,
  paid_for        text            -- items sold, or "Room balance <ref>"
);
CREATE INDEX IF NOT EXISTS card_foreign_payers_day_idx ON card_foreign_payers(day, created_at);
