-- Current prices read from the booking sites' public pages (for comparison only; nothing is changed on the sites).
CREATE TABLE IF NOT EXISTS site_prices (
  channel     text        NOT NULL,
  stay_date   date        NOT NULL,
  room        text        NOT NULL,
  price_cents bigint      NOT NULL,
  currency    text        NOT NULL DEFAULT 'EGP',
  checked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, stay_date, room)
);
-- The hostel's own pages on each site (owner can change them in Bookings by source).
INSERT INTO settings(key, value) VALUES ('channel_links', '{
  "hostelworld": "https://www.hostelworld.com/hostels/p/330811/villa-layla/",
  "expedia_collect": "https://www.expedia.com/Cairo-Hotels-Layla-Hostel.h112837968.Hotel-Information",
  "expedia_hotel": "https://www.expedia.com/Cairo-Hotels-Layla-Hostel.h112837968.Hotel-Information",
  "agoda": "https://www.agoda.com/layla-hostel/hotel/cairo-eg.html",
  "airbnb": "https://www.airbnb.com/rooms/1341441606875118299"
}'::jsonb) ON CONFLICT (key) DO NOTHING;

-- Agoda gets its own section.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_source_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('website','telegram','staff','import','walk_in','channel','booking_com','airbnb','hostelworld','expedia','agoda'));
