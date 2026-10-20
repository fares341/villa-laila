-- ════════════════════════════════════════════════════════════════════
-- Phase 1 PMS: folio ledger, day-by-day rates, channel manager (Little Hotelier),
-- housekeeping status, staff / roster / attendance, POS shifts with blind close,
-- catalog (market, meals, services, tours), event costs, InstaPay proof uploads.
-- Everything is additive; existing tables keep working.
-- ════════════════════════════════════════════════════════════════════

-- ───────── Rooms: housekeeping + channel mapping ─────────
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hk_status text NOT NULL DEFAULT 'clean';
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_hk_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_hk_status_check CHECK (hk_status IN ('clean','dirty','inspected','out_of_order'));
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hk_updated_at timestamptz;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS channel_code text;          -- room type / rate plan id in Little Hotelier

-- ───────── Reservations: walk-ins, channel bookings, real check-in/out times ─────────
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_source_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_source_check CHECK (source IN ('website','telegram','staff','import','walk_in','channel'));
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS channel_ref text;

-- ───────── Channel manager ─────────
-- One row per room type per calendar date: the rate Little Hotelier had for that night.
-- Past dates are never overwritten by later syncs, so the historical price of a night stays exact.
CREATE TABLE IF NOT EXISTS channel_daily_rates (
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  rate_date    date NOT NULL,
  rate_cents   bigint NOT NULL CHECK (rate_cents >= 0),
  currency     text NOT NULL DEFAULT 'EGP',
  source       text NOT NULL DEFAULT 'little_hotelier',   -- little_hotelier | csv_import | manual
  available    int,                                       -- units LH reported free, when known
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_type_id, rate_date)
);

CREATE TABLE IF NOT EXISTS channel_sync_log (
  id           bigserial PRIMARY KEY,
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  action       text NOT NULL,                             -- rates.pull | availability.push | stop_sell …
  room_type_id uuid REFERENCES room_types(id),
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL CHECK (status IN ('ok','error','skipped','queued')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_sync_log_created_idx ON channel_sync_log (created_at DESC);

-- ───────── Folio (guest account) ─────────
-- Charges are positive, credits (discounts, owner comps) negative. Payments live in `payments`.
CREATE TABLE IF NOT EXISTS folio_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  entry_date     date NOT NULL,                           -- the night (room) or the business day (others)
  kind           text NOT NULL CHECK (kind IN ('room','pos','custom','event','tour','comp','discount','adjustment')),
  description    text NOT NULL,
  quantity       numeric(10,2) NOT NULL DEFAULT 1,
  unit_cents     bigint NOT NULL,
  amount_cents   bigint NOT NULL,
  currency       text NOT NULL DEFAULT 'EGP',
  unit_id        uuid REFERENCES units(id),               -- room nights: which bed/room
  room_type_id   uuid REFERENCES room_types(id),
  rate_source    text,                                    -- override | booking | little_hotelier | local_rate
  ref_type       text,                                    -- service_order | event_booking | tour_booking …
  ref_id         text,
  shift_id       uuid REFERENCES cash_shifts(id),
  staff_id       uuid,                                    -- POS cashier (staff.id)
  created_by     uuid REFERENCES users(id),
  note           text,
  voided         boolean NOT NULL DEFAULT false,
  void_reason    text,
  voided_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folio_entries_res_idx ON folio_entries (reservation_id) WHERE NOT voided;
CREATE UNIQUE INDEX IF NOT EXISTS folio_one_room_night ON folio_entries (reservation_id, entry_date, unit_id) WHERE kind = 'room' AND NOT voided;

-- Manager rate override for part or all of a stay (audited).
CREATE TABLE IF NOT EXISTS rate_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  from_date      date NOT NULL,
  to_date        date NOT NULL,                           -- exclusive, like check_out
  rate_cents     bigint NOT NULL CHECK (rate_cents >= 0), -- per unit per night
  reason         text NOT NULL,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date > from_date)
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES cash_shifts(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_id uuid;

-- ───────── Staff, roster, attendance ─────────
CREATE TABLE IF NOT EXISTS staff (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             text NOT NULL,
  role                  text NOT NULL DEFAULT 'Receptionist',
  phone                 text,
  pin_hash              text,                             -- bcrypt of the 4–6 digit PIN
  user_id               uuid REFERENCES users(id),        -- optional dashboard login
  is_manager            boolean NOT NULL DEFAULT false,   -- may approve comps / overrides on the POS
  can_use_pos           boolean NOT NULL DEFAULT true,
  monthly_target_hours  numeric(6,1) NOT NULL DEFAULT 208,
  hourly_rate_cents     bigint NOT NULL DEFAULT 0,
  daily_rate_cents      bigint NOT NULL DEFAULT 0,        -- base for quarter/half/full-day deductions
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shift_types (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  start_time text,                                        -- 'HH:MM' Cairo time; NULL for day off
  end_time   text,
  is_off     boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO shift_types (code,label,start_time,end_time,is_off,sort_order) VALUES
  ('MORNING','Morning','07:00','15:00',false,1),
  ('EVENING','Evening','15:00','23:00',false,2),
  ('NIGHT','Night','23:00','07:00',false,3),
  ('OFF','Day off',NULL,NULL,true,9)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_roster (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  work_date   date NOT NULL,
  shift_code  text NOT NULL REFERENCES shift_types(code),
  start_time  text,                                       -- copied from shift type, editable per day
  end_time    text,
  note        text,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, work_date)
);
CREATE INDEX IF NOT EXISTS staff_roster_date_idx ON staff_roster (work_date);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         uuid NOT NULL REFERENCES staff(id),
  work_date        date NOT NULL,
  roster_id        uuid REFERENCES staff_roster(id) ON DELETE SET NULL,
  shift_code       text,
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  clock_in_at      timestamptz NOT NULL DEFAULT now(),
  clock_out_at     timestamptz,
  delay_ms         bigint NOT NULL DEFAULT 0,
  delay_minutes    int NOT NULL DEFAULT 0,
  tier             int NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 3),
  deduction_cents  bigint NOT NULL DEFAULT 0,
  waived           boolean NOT NULL DEFAULT false,
  waived_by        uuid REFERENCES users(id),
  waive_reason     text,
  waived_at        timestamptz,
  cash_shift_id    uuid REFERENCES cash_shifts(id),
  source           text NOT NULL DEFAULT 'pos',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_one_open_attendance ON staff_attendance (staff_id) WHERE clock_out_at IS NULL;
CREATE INDEX IF NOT EXISTS staff_attendance_date_idx ON staff_attendance (work_date);

INSERT INTO settings (key, value) VALUES ('lateness_policy',
  '{"grace_minutes":15,"mode":"fixed","tiers":[{"from":16,"to":30,"fixed_cents":5000,"day_fraction":0.25},{"from":31,"to":60,"fixed_cents":10000,"day_fraction":0.5},{"from":61,"to":null,"fixed_cents":null,"day_fraction":1,"alert":true}]}')
ON CONFLICT (key) DO NOTHING;

-- ───────── POS shifts (extends cash_shifts) ─────────
CREATE SEQUENCE IF NOT EXISTS cash_shift_no_seq START 101;
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS shift_no bigint DEFAULT nextval('cash_shift_no_seq');
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES staff(id);
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS closed_by_staff uuid REFERENCES staff(id);
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS opened_at timestamptz DEFAULT now();
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS counted_cash_cents bigint;
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS expected_cash_cents bigint;
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS variance_cents bigint;
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS z_report jsonb;
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS blind_close boolean NOT NULL DEFAULT false;

-- ───────── Catalog ─────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS pos_category text NOT NULL DEFAULT 'market';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_pos_category_check;
ALTER TABLE products ADD CONSTRAINT products_pos_category_check CHECK (pos_category IN ('market','meals','services'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT false;  -- offered on the website
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_label text;                                -- per person, per bag …
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_uidx ON products (barcode) WHERE barcode IS NOT NULL AND barcode <> '';

-- English names for the existing bilingual seed ("مياه … (Small Water)" → "Small Water")
UPDATE products SET name = regexp_replace(name, '^.*\((.+)\)\s*$', '\1') WHERE name ~ '\(.+\)\s*$' AND name ~ '[؀-ۿ]';
UPDATE products SET pos_category = CASE
    WHEN category IN ('meal_breakfast') THEN 'meals'
    WHEN category IN ('laundry','other','transport') THEN 'services'
    ELSE 'market' END;
-- Tours move to their own catalog (below); keep old rows for history but hide them from the POS.
UPDATE products SET is_active = false WHERE category = 'activity_tour';
-- Phase 1 price list
UPDATE products SET is_active = false WHERE name IN ('Hostel Breakfast','Laundry Bag');
INSERT INTO products (name, category, pos_category, price_cents, cost_cents, stock_quantity, track_stock, low_stock_threshold, public_visible, unit_label, sort_order) VALUES
  ('Breakfast', 'meal_breakfast', 'meals', 15000, 0, 0, false, 0, true, 'per person', 1),
  ('Lunch', 'meal_breakfast', 'meals', 30000, 0, 0, false, 0, true, 'per person', 2),
  ('Laundry Service', 'laundry', 'services', 15000, 0, 0, false, 0, false, 'per bag / load', 1),
  ('Extra Towel', 'linen_towel', 'services', 5000, 0, 0, false, 0, true, 'each', 2)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS tours_catalog (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  organizer    text NOT NULL,
  description  text,
  duration     text,
  cost_cents   bigint NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  price_cents  bigint NOT NULL CHECK (price_cents >= 0),
  currency     text NOT NULL DEFAULT 'EGP',
  active       boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tours_catalog (name, organizer, duration, cost_cents, price_cents, sort_order)
SELECT regexp_replace(name, '^.*\((.+)\)\s*$', '\1'), 'Villa Layla Tours Desk',
       NULL, cost_cents, price_cents, row_number() OVER (ORDER BY price_cents)
FROM products WHERE category = 'activity_tour' AND NOT EXISTS (SELECT 1 FROM tours_catalog);

-- Sale lines: POS sales reuse service_orders so the existing reports keep working.
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS sale_id uuid;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES cash_shifts(id);
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS pos_staff_id uuid REFERENCES staff(id);
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS unit_cost_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS unit_price_cents bigint;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS item_name text;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS tour_id uuid REFERENCES tours_catalog(id);
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS comp_note text;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS comp_approved_by uuid REFERENCES staff(id);
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_service_type_check;
ALTER TABLE service_orders ADD CONSTRAINT service_orders_service_type_check CHECK (service_type IN ('breakfast','laundry','towel','pool','water','taxi','tour','meal','extra_bed','drinks','other','market','custom','event'));
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_payment_method_check;
ALTER TABLE service_orders ADD CONSTRAINT service_orders_payment_method_check CHECK (payment_method IN ('cash','card_terminal','instapay','bank_transfer','room_charge','comp','other'));
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_payment_status_check;
ALTER TABLE service_orders ADD CONSTRAINT service_orders_payment_status_check CHECK (payment_status IN ('paid','unpaid','charged_to_room','refunded','comp','void'));
CREATE INDEX IF NOT EXISTS idx_service_orders_shift ON service_orders (shift_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_sale ON service_orders (sale_id);

ALTER TABLE cash_expenses ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT true;
ALTER TABLE cash_expenses ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES staff(id);

-- Owner comps / allowances (folio comps and comped POS carts both land here for the report).
CREATE TABLE IF NOT EXISTS owner_comps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id),
  sale_id        uuid,
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  currency       text NOT NULL DEFAULT 'EGP',
  note           text NOT NULL,
  approved_by    uuid REFERENCES staff(id),
  approved_by_user uuid REFERENCES users(id),
  cashier_id     uuid REFERENCES staff(id),
  shift_id       uuid REFERENCES cash_shifts(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ───────── Events: costs, profit, day-use ─────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS cost_per_attendee_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'event';
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_kind_check;
ALTER TABLE events ADD CONSTRAINT events_kind_check CHECK (kind IN ('event','day_use'));
UPDATE events SET kind = 'day_use' WHERE slug = 'pool-day';

-- InstaPay transfer screenshots (stored in the DB so they survive container rebuilds; max ~5 MB enforced in code)
ALTER TABLE online_payments ADD COLUMN IF NOT EXISTS proof bytea;
ALTER TABLE online_payments ADD COLUMN IF NOT EXISTS proof_mime text;

-- Event images uploaded from the dashboard (served by /api/media/event/[id])
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_bytes bytea;
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_mime text;
-- Website event payments: Paymob or InstaPay only (cash stays available at the desk)
UPDATE events SET pay_methods = ARRAY['paymob','instapay']::text[];
ALTER TABLE events ALTER COLUMN pay_methods SET DEFAULT '{paymob,instapay}';

-- Event tickets paid in cash at the desk go into the open POS drawer (counted in the Z-report).
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES cash_shifts(id);

-- One definition of "what the guest owes for" used by every list, report, bot message and the folio:
-- room nights (posted at check-in, or the booked total before that) + POS/custom/event charges − comps/discounts.
CREATE OR REPLACE FUNCTION folio_charges(rid uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT (CASE WHEN EXISTS (SELECT 1 FROM folio_entries WHERE reservation_id = rid AND kind = 'room' AND NOT voided)
               THEN 0 ELSE COALESCE((SELECT total_cents FROM reservations WHERE id = rid), 0) END
          + COALESCE((SELECT sum(amount_cents) FROM folio_entries WHERE reservation_id = rid AND NOT voided), 0))::bigint
$$;
