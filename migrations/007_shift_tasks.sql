-- Shift tasks: a fixed checklist per shift, shared at random (but balanced) between the staff clocked in.

CREATE TABLE IF NOT EXISTS shift_task_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'check' CHECK (kind IN ('check','money','unpaid','washes','tours','taxi')),
                                                                 -- money: done by whoever opens the drawer (receives the cash)
  items       text[] NOT NULL DEFAULT '{}',                       -- sub-checks, e.g. Cups / Water dispenser
  shift_codes text[] NOT NULL DEFAULT '{MORNING,EVENING,NIGHT}',  -- which shifts get this task
  minutes     int NOT NULL DEFAULT 10 CHECK (minutes BETWEEN 1 AND 480),
  phase       text NOT NULL DEFAULT 'last_hour' CHECK (phase IN ('start','last_hour')),  -- when in the shift it is shared
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shift_task_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date      date NOT NULL,              -- the day the shift starts (a night shift belongs to the evening it starts)
  shift_code     text NOT NULL REFERENCES shift_types(code),
  distributed_at timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_date, shift_code)
);

CREATE TABLE IF NOT EXISTS shift_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES shift_task_runs(id) ON DELETE CASCADE,
  template_id  uuid REFERENCES shift_task_templates(id) ON DELETE SET NULL,
  title        text NOT NULL,
  kind         text NOT NULL DEFAULT 'check',
  items        jsonb NOT NULL DEFAULT '[]',   -- [{label, done}]
  minutes      int NOT NULL DEFAULT 10,
  phase        text NOT NULL DEFAULT 'last_hour',
  source       text NOT NULL DEFAULT 'template',  -- template | taxi | tour | manual
  ref_id       uuid,                              -- taxi booking / service order behind the task
  sort_order   int NOT NULL DEFAULT 0,
  assigned_to  uuid REFERENCES staff(id),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  note         text,
  started_at   timestamptz,                   -- first tick: the task is no longer moved when rebalancing
  done_at      timestamptz,
  done_by      uuid REFERENCES staff(id),
  missed_at    timestamptz,                   -- the shift ended with the task still open
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_tasks_run_idx ON shift_tasks (run_id);
CREATE INDEX IF NOT EXISTS shift_tasks_staff_idx ON shift_tasks (assigned_to);

-- Laundry jobs can be marked ready from the "Washes status" task.
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS ready_at timestamptz;

INSERT INTO settings (key, value) VALUES ('shift_tasks', '{"distribute_after_minutes":15}') ON CONFLICT (key) DO NOTHING;

-- The reception handover checklist. Money and visa are checked by whoever receives the drawer at the start of a shift;
-- the rest is done in the last hour before handover.
INSERT INTO shift_task_templates (title, kind, items, minutes, sort_order, phase)
SELECT * FROM (VALUES
  ('Money received and checked', 'money', '{}'::text[], 10, 1, 'start'),
  ('Visa received and checked', 'money', '{}'::text[], 5, 2, 'start'),
  ('Taxi status', 'taxi', '{}'::text[], 5, 3, 'start'),
  ('All room keys in place', 'check', '{}'::text[], 5, 4, 'last_hour'),
  ('Coffee corners clean and ready', 'check', '{"Cups","Water dispenser","Tea & coffee"}'::text[], 15, 5, 'last_hour'),
  ('Bathrooms status', 'check', '{"Floor","Toilet paper","Trash bins","Air freshener","Water"}'::text[], 20, 6, 'last_hour'),
  ('OTA messages', 'check', '{"WhatsApp","Booking.com","Expedia","Reception emails"}'::text[], 15, 7, 'last_hour'),
  ('Tours status', 'tours', '{}'::text[], 5, 8, 'last_hour'),
  ('Washes status', 'washes', '{}'::text[], 10, 9, 'last_hour'),
  ('Not paid reminder', 'unpaid', '{}'::text[], 10, 10, 'last_hour')
) AS v(title, kind, items, minutes, sort_order, phase)
WHERE NOT EXISTS (SELECT 1 FROM shift_task_templates);

-- ───────── Real shift times ─────────
ALTER TABLE shift_types ADD COLUMN IF NOT EXISTS core boolean NOT NULL DEFAULT true;   -- core shifts hand the cash drawer over
UPDATE shift_types SET label='Morning',   start_time='08:00', end_time='16:30' WHERE code='MORNING';
UPDATE shift_types SET label='Afternoon', start_time='15:30', end_time='00:00' WHERE code='EVENING';
UPDATE shift_types SET label='Night',     start_time='00:00', end_time='08:00' WHERE code='NIGHT';
INSERT INTO shift_types (code,label,start_time,end_time,is_off,sort_order,core) VALUES
  ('MID10','In-between 10:00','10:00','18:30',false,4,false),
  ('MID12','In-between 12:00','12:00','20:30',false,5,false)
ON CONFLICT (code) DO NOTHING;
UPDATE staff_roster r SET start_time=st.start_time, end_time=st.end_time FROM shift_types st WHERE st.code=r.shift_code AND r.work_date >= current_date;

-- ───────── Cash in three currencies, Taken, shortages ─────────
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_take_cash boolean NOT NULL DEFAULT false;   -- may record "Taken" (cash removed by the owner)

ALTER TABLE payments ADD COLUMN IF NOT EXISTS cash_currency text NOT NULL DEFAULT 'EGP';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cash_amount_minor bigint;     -- what physically went into the drawer, in cash_currency
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fx_rate numeric(12,4);        -- EGP per 1 unit of cash_currency
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS paid_currency text NOT NULL DEFAULT 'EGP';
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS paid_amount_minor bigint;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS fx_rate numeric(12,4);
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS open_count jsonb;          -- what the incoming person counted when receiving the drawer

CREATE TABLE IF NOT EXISTS cash_taken (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id    uuid NOT NULL REFERENCES cash_shifts(id),
  staff_id    uuid NOT NULL REFERENCES staff(id),     -- who took the money (owner)
  egp_cents   bigint NOT NULL DEFAULT 0,
  usd_cents   bigint NOT NULL DEFAULT 0,
  eur_cents   bigint NOT NULL DEFAULT 0,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_shortages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id     uuid NOT NULL REFERENCES cash_shifts(id),
  staff_id     uuid REFERENCES staff(id),              -- the person who handed over
  currency     text NOT NULL,
  amount_minor bigint NOT NULL,                        -- positive = missing
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid_cash','salary','waived')),
  note         text,
  resolved_by  uuid REFERENCES users(id),
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES ('fx_rates', '{"USD":null,"EUR":null,"source":"none"}') ON CONFLICT (key) DO NOTHING;

-- ───────── Airport taxi ─────────
INSERT INTO settings (key, value) VALUES ('taxi_prices', '{"currency":"USD","cairo":2500,"sphinx":3000}') ON CONFLICT (key) DO NOTHING;
CREATE TABLE IF NOT EXISTS taxi_bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id),
  guest_name     text NOT NULL,
  phone          text,
  room_label     text,
  direction      text NOT NULL CHECK (direction IN ('pickup','dropoff')),
  airport        text NOT NULL CHECK (airport IN ('cairo','sphinx')),
  scheduled_at   timestamptz NOT NULL,
  price_minor    bigint NOT NULL,
  price_currency text NOT NULL DEFAULT 'USD',
  fx_rate        numeric(12,4),
  folio_entry_id uuid REFERENCES folio_entries(id),
  status         text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','done','cancelled')),
  confirmed_at   timestamptz,                           -- guest was messaged that the driver will wait
  confirmed_by   uuid REFERENCES staff(id),
  note           text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS taxi_bookings_when_idx ON taxi_bookings (scheduled_at);
ALTER TABLE folio_entries DROP CONSTRAINT IF EXISTS folio_entries_kind_check;
ALTER TABLE folio_entries ADD CONSTRAINT folio_entries_kind_check CHECK (kind IN ('room','pos','custom','event','tour','comp','discount','adjustment','taxi'));

-- ───────── Tour catalogs sent to guests ─────────
ALTER TABLE tours_catalog ADD COLUMN IF NOT EXISTS guest_message text;
CREATE TABLE IF NOT EXISTS tour_files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id    uuid NOT NULL REFERENCES tours_catalog(id) ON DELETE CASCADE,
  name       text NOT NULL,
  mime       text NOT NULL,
  bytes      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
