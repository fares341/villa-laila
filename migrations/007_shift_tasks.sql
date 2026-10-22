-- Shift tasks: a fixed checklist per shift, shared at random (but balanced) between the staff clocked in.

CREATE TABLE IF NOT EXISTS shift_task_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'check' CHECK (kind IN ('check','money','unpaid','washes','tours','taxi')),
  items       text[] NOT NULL DEFAULT '{}',                       -- sub-checks, e.g. Cups / Water dispenser
  shift_codes text[] NOT NULL DEFAULT '{MORNING,EVENING,NIGHT}',  -- which shifts get this task
  minutes     int NOT NULL DEFAULT 10 CHECK (minutes BETWEEN 1 AND 480),
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
  sort_order   int NOT NULL DEFAULT 0,
  assigned_to  uuid REFERENCES staff(id),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  note         text,
  started_at   timestamptz,                   -- first tick: the task is no longer moved when rebalancing
  done_at      timestamptz,
  done_by      uuid REFERENCES staff(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_tasks_run_idx ON shift_tasks (run_id);
CREATE INDEX IF NOT EXISTS shift_tasks_staff_idx ON shift_tasks (assigned_to);

-- Laundry jobs can be marked ready from the "Washes status" task.
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS ready_at timestamptz;

INSERT INTO settings (key, value) VALUES ('shift_tasks', '{"distribute_after_minutes":15}') ON CONFLICT (key) DO NOTHING;

-- The reception handover checklist.
INSERT INTO shift_task_templates (title, kind, items, minutes, sort_order)
SELECT * FROM (VALUES
  ('Money received and checked', 'money', '{}'::text[], 10, 1),
  ('Visa received and checked', 'check', '{}'::text[], 5, 2),
  ('All room keys in place', 'check', '{}'::text[], 5, 3),
  ('Coffee corners clean and ready', 'check', '{"Cups","Water dispenser","Tea & coffee"}'::text[], 15, 4),
  ('Bathrooms status', 'check', '{"Floor","Toilet paper","Trash bins","Air freshener"}'::text[], 20, 5),
  ('OTA messages', 'check', '{"WhatsApp","Booking.com","Expedia","Reception emails"}'::text[], 15, 6),
  ('Tours status', 'tours', '{}'::text[], 5, 8),
  ('Washes status', 'washes', '{}'::text[], 10, 9),
  ('Not paid reminder', 'unpaid', '{}'::text[], 10, 10)
) AS v(title, kind, items, minutes, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM shift_task_templates);
