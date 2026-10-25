-- Optional add-on on event tickets: home-cooked dinner by the pool, priced per person.
-- events.dinner_cents NULL = not offered for that event. The booking keeps what was chosen.
ALTER TABLE events ADD COLUMN IF NOT EXISTS dinner_cents integer CHECK (dinner_cents IS NULL OR dinner_cents >= 0);
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS dinner boolean NOT NULL DEFAULT false;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS dinner_cents integer NOT NULL DEFAULT 0;   -- per person, at booking time

-- Offer it (EGP 300) on the existing evening events; not on meal events themselves (dinner / breakfast / lunch / brunch).
UPDATE events SET dinner_cents = 30000
WHERE dinner_cents IS NULL AND kind = 'event'
  AND COALESCE(title->>'en','') !~* '(dinner|breakfast|lunch|brunch|iftar)'
  AND COALESCE(title->>'ar','') !~ '(عشاء|إفطار|افطار|غداء|فطور)';
