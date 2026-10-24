-- Little Hotelier reader: a read-only script signs in once (session kept), checks the bookings every minute and
-- copies new / cancelled site bookings into "Bookings from sites". Nothing is ever changed in Little Hotelier.
CREATE TABLE IF NOT EXISTS lh_seen (
  lh_key          text PRIMARY KEY,           -- channel + confirmation number as read from Little Hotelier
  hash            text NOT NULL,              -- detects changes (dates, price, status)
  reservation_id  uuid REFERENCES reservations(id) ON DELETE SET NULL,
  status          text NOT NULL,              -- imported | cancelled | skipped | dry_run | error
  detail          text,
  data            jsonb NOT NULL,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  last_seen       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lh_runs (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  ok          boolean NOT NULL,
  found       int NOT NULL DEFAULT 0,
  imported    int NOT NULL DEFAULT 0,
  cancelled   int NOT NULL DEFAULT 0,
  message     text
);
