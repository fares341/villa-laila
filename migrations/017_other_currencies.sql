-- Cash in rare currencies (GBP, SAR, ...): counted in the drawer like USD / EUR.
ALTER TABLE cash_taken ADD COLUMN IF NOT EXISTS other jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cash_exchanges DROP CONSTRAINT IF EXISTS cash_exchanges_currency_check;
ALTER TABLE cash_exchanges ADD CONSTRAINT cash_exchanges_currency_check CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'EGP');
