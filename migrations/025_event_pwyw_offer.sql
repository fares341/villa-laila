-- Hostel guests: the amount they say (on the website) they want to pay for the tickets ("pay what you want").
-- Only a note for reception: the money itself is taken and counted on the POS.
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS pwyw_offer_cents integer CHECK (pwyw_offer_cents IS NULL OR pwyw_offer_cents >= 0);
