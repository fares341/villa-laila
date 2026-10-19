-- 004_frontdesk_operations.sql
-- Mini-Market, Inventory Control, Towel Tracking, Daily POS Service Log, Shifts, Drawer & Expenses, Tours & Transfers

-- ───────── Products / Market Items ─────────
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('beverage', 'snack', 'linen_towel', 'laundry', 'meal_breakfast', 'activity_tour', 'transport', 'other')),
  price_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EGP',
  cost_cents bigint NOT NULL DEFAULT 0,
  stock_quantity int NOT NULL DEFAULT 0,
  track_stock boolean NOT NULL DEFAULT true,
  low_stock_threshold int NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────── Inventory Movements & Audits ─────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'damage', 'loss', 'return', 'adjustment_audit')),
  quantity int NOT NULL,
  previous_stock int NOT NULL,
  new_stock int NOT NULL,
  reference text,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_movements_product ON inventory_movements (product_id, created_at DESC);

-- ───────── Front Desk Service Orders (Daily Log) ─────────
CREATE TABLE IF NOT EXISTS service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  order_date date NOT NULL DEFAULT current_date,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_name text NOT NULL,
  room_number text,
  service_type text NOT NULL CHECK (service_type IN ('breakfast', 'laundry', 'towel', 'pool', 'water', 'taxi', 'tour', 'meal', 'extra_bed', 'drinks', 'other')),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  quantity int NOT NULL DEFAULT 1,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency IN ('EGP','USD','EUR')),
  payment_method text CHECK (payment_method IN ('cash','card_terminal','instapay','bank_transfer','room_charge','other')),
  payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','unpaid','charged_to_room','refunded')),
  staff_id uuid REFERENCES users(id),
  staff_name text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_orders_date ON service_orders (order_date DESC);
CREATE INDEX IF NOT EXISTS idx_service_orders_res ON service_orders (reservation_id);

-- ───────── Cash Shifts & Drawer Reconciliation ─────────
CREATE TABLE IF NOT EXISTS cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date date NOT NULL DEFAULT current_date,
  shift_name text NOT NULL DEFAULT 'Morning' CHECK (shift_name IN ('Morning','Evening','Night','Full Day')),
  opened_by uuid REFERENCES users(id),
  closed_by uuid REFERENCES users(id),
  drawer_egp_start bigint NOT NULL DEFAULT 0,
  drawer_usd_start numeric(10,2) NOT NULL DEFAULT 0,
  drawer_eur_start numeric(10,2) NOT NULL DEFAULT 0,
  drawer_egp_actual bigint NOT NULL DEFAULT 0,
  drawer_usd_actual numeric(10,2) NOT NULL DEFAULT 0,
  drawer_eur_actual numeric(10,2) NOT NULL DEFAULT 0,
  pos_terminal_actual bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','taken')),
  taken_at timestamptz,
  taken_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_date ON cash_shifts (shift_date DESC);

-- ───────── Petty Cash Expenses from Drawer ─────────
CREATE TABLE IF NOT EXISTS cash_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid REFERENCES cash_shifts(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT current_date,
  category text NOT NULL CHECK (category IN ('supplies', 'food_kitchen', 'maintenance', 'transport_taxi', 'pet_care', 'tips_wages', 'refund', 'other')),
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency IN ('EGP','USD','EUR')),
  description text NOT NULL,
  recorded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_date ON cash_expenses (date DESC);

-- ───────── Tours & Travel Desk ─────────
CREATE TABLE IF NOT EXISTS tour_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number text NOT NULL UNIQUE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_name text NOT NULL,
  room_number text,
  destination text NOT NULL,
  tour_date date NOT NULL,
  pickup_time text NOT NULL DEFAULT '07:00',
  guests_count int NOT NULL DEFAULT 1,
  guide_name text,
  driver_name text,
  driver_phone text,
  price_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency IN ('EGP','USD','EUR')),
  cost_cents bigint NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid','charged_to_room','cancelled')),
  payment_method text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','dispatched','completed','cancelled')),
  booked_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tour_bookings_date ON tour_bookings (tour_date DESC);

-- ───────── Towel & Linen Tracking ─────────
CREATE TABLE IF NOT EXISTS towel_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_name text NOT NULL,
  room_number text,
  quantity int NOT NULL DEFAULT 1,
  towel_type text NOT NULL DEFAULT 'bath_towel' CHECK (towel_type IN ('bath_towel','pool_towel','blanket','other')),
  loaned_at timestamptz NOT NULL DEFAULT now(),
  deposit_cents bigint NOT NULL DEFAULT 0,
  deposit_currency text NOT NULL DEFAULT 'EGP',
  deposit_status text NOT NULL DEFAULT 'none' CHECK (deposit_status IN ('none','paid','refunded','forfeited')),
  returned boolean NOT NULL DEFAULT false,
  returned_at timestamptz,
  loaned_by uuid REFERENCES users(id),
  notes text
);
CREATE INDEX IF NOT EXISTS idx_towel_loans_returned ON towel_loans (returned);

-- ───────── Initial Seed of Hostel Market & Services Products ─────────
INSERT INTO products (name, category, price_cents, cost_cents, stock_quantity, track_stock, low_stock_threshold)
VALUES
  ('مياه معدنية صغيرة (Small Water)', 'beverage', 3000, 1500, 60, true, 10),
  ('مياه معدنية كبيرة (Large Water)', 'beverage', 6000, 3000, 40, true, 8),
  ('كانز كولا / صودا (Soft Drink / Cola)', 'beverage', 6500, 4000, 45, true, 10),
  ('عصير طبيعي (Fresh Juice)', 'beverage', 8000, 4500, 25, true, 5),
  ('شيبسي ومقرمشات (Chips & Snacks)', 'snack', 3500, 2000, 50, true, 10),
  ('فوطة استحمام (Bath Towel)', 'linen_towel', 6000, 3500, 80, true, 15),
  ('فوطة مسبح (Pool Towel)', 'linen_towel', 8000, 5000, 40, true, 10),
  ('بطانية / ملاية إضافية (Blanket / Bed Sheet)', 'linen_towel', 10000, 6000, 30, true, 5),
  ('إفطار فيلا ليلى (Hostel Breakfast)', 'meal_breakfast', 12000, 6000, 0, false, 0),
  ('غسيل ملابس كيس كامل (Laundry Bag)', 'laundry', 16500, 6000, 0, false, 0),
  ('دخول المسبح اليومي (Pool Pass)', 'other', 44000, 10000, 0, false, 0),
  ('تاكسي المطار (Airport Taxi Transfer)', 'transport', 110000, 80000, 0, false, 0),
  ('جولة الأهرامات وأبو الهول (Pyramids Tour)', 'activity_tour', 250000, 150000, 0, false, 0),
  ('جولة سقارة ودهشور (Saqqara Tour)', 'activity_tour', 380000, 240000, 0, false, 0),
  ('عشاء نيلي بالمركب (Nile Dinner Cruise)', 'activity_tour', 180000, 120000, 0, false, 0),
  ('رحلة الإسكندرية اليومية (Alexandria Tour)', 'activity_tour', 550000, 350000, 0, false, 0)
ON CONFLICT DO NOTHING;
