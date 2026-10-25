-- Airport taxi drivers: each booking gets a driver; the driver is messaged on WhatsApp with the guest's details
-- when assigned, and reminded 30 minutes before the trip.
CREATE TABLE IF NOT EXISTS taxi_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  car text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE taxi_bookings ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES taxi_drivers(id);
ALTER TABLE taxi_bookings ADD COLUMN IF NOT EXISTS driver_notified_at timestamptz;   -- the job message went out automatically
ALTER TABLE taxi_bookings ADD COLUMN IF NOT EXISTS driver_reminded_at timestamptz;   -- 30-minute reminder handled (sent, or handed to the owner's Telegram)
