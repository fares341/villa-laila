-- Events: how villa guests pay (pay what you want / a fixed price / no villa-guest option), other events that can
-- be added on the same day, which weekly menu the page shows. Bookings: name + phone of each extra person, add-on.
ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_mode text NOT NULL DEFAULT 'pwyw';
ALTER TABLE events ADD COLUMN IF NOT EXISTS addon_event_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS menu_kind text;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS attendees jsonb;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS addon_event_id uuid REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS addon_cents bigint;
-- Weekly menus: dinner and breakfast.
ALTER TABLE weekly_menu ADD COLUMN IF NOT EXISTS meal text NOT NULL DEFAULT 'dinner';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='weekly_menu_pkey' AND pg_get_constraintdef(oid)='PRIMARY KEY (weekday)') THEN
    ALTER TABLE weekly_menu DROP CONSTRAINT weekly_menu_pkey;
    ALTER TABLE weekly_menu ADD PRIMARY KEY (meal, weekday);
  END IF;
END $$;
