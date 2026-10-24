-- InstaPay / Vodafone Cash taken at the desk on the POS (EGP, transaction number kept). Not in the cash drawer.
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_payment_method_check;
ALTER TABLE service_orders ADD CONSTRAINT service_orders_payment_method_check
  CHECK (payment_method IN ('cash','card_terminal','instapay','vodafone_cash','bank_transfer','room_charge','comp','other'));
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS wallet_ref text;
ALTER TABLE event_bookings DROP CONSTRAINT IF EXISTS event_bookings_pos_method_check;
ALTER TABLE event_bookings ADD CONSTRAINT event_bookings_pos_method_check CHECK (pos_method IS NULL OR pos_method IN ('cash','card','instapay','vodafone_cash'));
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS pos_ref text;
ALTER TABLE cash_tips DROP CONSTRAINT IF EXISTS cash_tips_method_check;
ALTER TABLE cash_tips ADD CONSTRAINT cash_tips_method_check CHECK (method IN ('cash','card','instapay','vodafone_cash'));
