-- Cancelling an event on one day and telling everyone: the day is closed for new bookings, and each booking keeps
-- the message it was sent and how it reached the guest (WhatsApp / e-mail), so staff can see who still has to be told.
ALTER TABLE events ADD COLUMN IF NOT EXISTS closed_dates text[] NOT NULL DEFAULT '{}';
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS cancel_message text;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS cancel_notified text;
-- Collab events: cancelled as a whole, with the message everyone was sent.
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS cancel_message text;
ALTER TABLE collab_rsvps ADD COLUMN IF NOT EXISTS cancel_notified text;
