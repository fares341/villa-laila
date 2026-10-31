-- Website bookings copied into the hostel's booking engine (direct-book.com) by the direct-reader service,
-- so Little Hotelier closes the beds on every channel.
CREATE TABLE IF NOT EXISTS direct_book_pushes (
  reservation_id uuid PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',     -- queued | running | dry_ok | booked | failed | skipped
  attempts int NOT NULL DEFAULT 0,
  confirmation text,                          -- direct-book's booking reference
  message text,
  steps jsonb,                                -- what the script saw at each step (for checking)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
