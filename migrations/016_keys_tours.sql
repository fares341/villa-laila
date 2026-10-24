-- Key inventory per room (no money is ever taken for keys): is the original key here, is the spare here?
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS key_original boolean NOT NULL DEFAULT true;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS key_spare boolean NOT NULL DEFAULT true;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS key_note text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS key_checked_at timestamptz;

-- Tour sales get the trip details the old Tours sheet kept: day, pick-up time, guide, driver.
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS tour_date date;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS tour_time text;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS guide_name text;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS driver_phone text;

-- Event tickets can be paid on the POS by card too; foreign card payers of event tickets go on the daily list.
ALTER TABLE event_bookings DROP CONSTRAINT IF EXISTS event_bookings_pay_method_check;
ALTER TABLE event_bookings ADD CONSTRAINT event_bookings_pay_method_check CHECK (pay_method IN ('paymob','instapay','vodafone_cash','cash','card'));
ALTER TABLE card_foreign_payers DROP CONSTRAINT IF EXISTS card_foreign_payers_source_check;
ALTER TABLE card_foreign_payers ADD CONSTRAINT card_foreign_payers_source_check CHECK (source IN ('pos_sale','folio_payment','event'));
