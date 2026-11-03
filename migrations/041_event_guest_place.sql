-- Events: villa-guest price can also be free or a % off the visitor price; each event can have its own written
-- address and map link (empty = the villa's); "gallery" media are the photos of the event's stories (9:16).
ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_discount_pct int;
ALTER TABLE events ADD COLUMN IF NOT EXISTS address jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS map_url text;
