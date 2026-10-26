-- Stay extensions are priced like Hostelworld (lines kept on the request so approval charges the same),
-- and extra nights from an extension show on the channel-manager alert until they are blocked there.
ALTER TABLE extension_requests ADD COLUMN IF NOT EXISTS price_lines jsonb;
ALTER TABLE extension_requests ADD COLUMN IF NOT EXISTS price_source text;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cm_ext_from date;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cm_ext_to date;
