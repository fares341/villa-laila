-- Weekly dinner menu: one meal per weekday (0 = Sunday … 6 = Saturday): one photo of the plate, its name and
-- the dishes on it. An event on a Monday shows Monday's meal on its booking page; the kitchen sees it on the booking.
CREATE TABLE IF NOT EXISTS weekly_menu (
  weekday     smallint PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  title       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {ar, en}  e.g. "طاجن لحمة بالبصل"
  dishes      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ar, en}] what is on the plate
  description jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {ar, en} optional
  photo       bytea,
  photo_mime  text,
  image_url   text,                                -- a photo link or a path in /public instead of an upload
  updated_at  timestamptz NOT NULL DEFAULT now()
);
