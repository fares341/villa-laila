-- The manager chooses who opens the cash drawer and who closes it; everyone else on the shift uses the POS normally.
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS closer_staff_id uuid REFERENCES staff(id);
