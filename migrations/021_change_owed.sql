-- Change the guest will come back for (e.g. towel EGP 50, guest gave EGP 100, takes the EGP 50 later).
-- The money sits in the drawer until it is given back, or the guest says keep it (then it becomes a tip).
CREATE TABLE IF NOT EXISTS cash_change_owed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  shift_id uuid NOT NULL REFERENCES cash_shifts(id),
  staff_id uuid REFERENCES staff(id),
  sale_id uuid,
  payment_id uuid,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest text NOT NULL,
  what text,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
  minor bigint NOT NULL CHECK (minor > 0),
  gave_minor bigint,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','given','tip')),
  settled_at timestamptz,
  settled_shift_id uuid REFERENCES cash_shifts(id),
  settled_staff_id uuid REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS cash_change_owed_open ON cash_change_owed(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS cash_change_owed_shift ON cash_change_owed(shift_id);
CREATE INDEX IF NOT EXISTS cash_change_owed_settled ON cash_change_owed(settled_shift_id);
ALTER TABLE cash_tips ADD COLUMN IF NOT EXISTS change_id uuid;
