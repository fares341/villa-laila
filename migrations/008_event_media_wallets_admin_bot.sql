-- Events: meal photos and videos, wallet payments (InstaPay / Vodafone Cash) set from the dashboard,
-- Telegram admin bot (booking alerts, confirm / cancel, edit events) and WhatsApp notices to guests.

-- ───────── Event media ─────────
CREATE TABLE IF NOT EXISTS event_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('meal','video','gallery')),
  bytes       bytea,                -- uploaded file (photo or short video)
  mime        text,
  url         text,                 -- or an outside link (YouTube, Instagram, .mp4)
  caption     text,
  orientation text NOT NULL DEFAULT 'landscape' CHECK (orientation IN ('landscape','portrait')), -- videos: wide or tall
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (bytes IS NOT NULL OR url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS event_media_event_idx ON event_media(event_id, kind, sort_order);

-- ───────── Wallet payments ─────────
ALTER TABLE event_bookings DROP CONSTRAINT IF EXISTS event_bookings_pay_method_check;
ALTER TABLE event_bookings ADD CONSTRAINT event_bookings_pay_method_check CHECK (pay_method IN ('paymob','instapay','vodafone_cash','cash'));
ALTER TABLE online_payments DROP CONSTRAINT IF EXISTS online_payments_provider_check;
ALTER TABLE online_payments ADD CONSTRAINT online_payments_provider_check CHECK (provider IN ('paymob','instapay','vodafone_cash'));

-- ───────── Booking follow-up (admin bot, reminders) ─────────
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS admin_notified_at timestamptz;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS attendance_confirmed_at timestamptz;

-- Conversation state of the admin bot (creating / editing an event step by step).
CREATE TABLE IF NOT EXISTS admin_bot_state (
  chat_id     text PRIMARY KEY,
  state       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Who receives the admin bot messages. The token is pasted in Dashboard → Events → Settings.
INSERT INTO settings(key, value) VALUES ('admin_bot', '{"token": "", "chat_ids": ["5622031108"]}')
ON CONFLICT (key) DO NOTHING;

-- Events that take InstaPay now also take Vodafone Cash (shown only once a Vodafone Cash number is saved).
UPDATE events SET pay_methods = array_append(pay_methods, 'vodafone_cash')
WHERE 'instapay' = ANY(pay_methods) AND NOT ('vodafone_cash' = ANY(pay_methods));
ALTER TABLE events ALTER COLUMN pay_methods SET DEFAULT '{paymob,instapay,vodafone_cash}';
