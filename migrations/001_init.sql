-- Villa Layla — initial schema. All money is stored as integer minor units (cents/piasters).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────── Staff ─────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner','manager','receptionist')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON login_attempts (key, created_at);

-- ───────── Inventory ─────────
CREATE TABLE room_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('dorm','private')),   -- dorm = priced per bed, private = priced per room
  name          jsonb NOT NULL,          -- {"en":"..","es":"..","fr":"..","ar":".."}
  description   jsonb NOT NULL DEFAULT '{}',
  amenities     jsonb NOT NULL DEFAULT '[]',
  active        boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0
);

CREATE TABLE rooms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  is_demo      boolean NOT NULL DEFAULT false
);

-- A bookable unit: one dorm bed, or one whole private room.
CREATE TABLE units (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   uuid NOT NULL REFERENCES rooms(id),
  label     text NOT NULL,
  capacity  int NOT NULL DEFAULT 1 CHECK (capacity > 0),
  active    boolean NOT NULL DEFAULT true,
  is_demo   boolean NOT NULL DEFAULT false,
  UNIQUE (room_id, label)
);

CREATE TABLE rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id  uuid NOT NULL REFERENCES room_types(id),
  name          text NOT NULL DEFAULT 'Base',
  price_cents   bigint NOT NULL CHECK (price_cents >= 0),   -- per bed (dorm) or per room (private) per night
  valid_during  daterange NOT NULL DEFAULT daterange(NULL, NULL, '[)'),
  priority      int NOT NULL DEFAULT 0,                      -- higher wins when ranges overlap (seasonal over base)
  is_demo       boolean NOT NULL DEFAULT false
);

CREATE TABLE unit_blocks (            -- maintenance / out of service
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    uuid NOT NULL REFERENCES units(id),
  during     daterange NOT NULL,
  reason     text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────── Guests ─────────
CREATE TABLE guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  email       text,
  phone       text,
  nationality text,
  language    text NOT NULL DEFAULT 'en' CHECK (language IN ('en','es','fr','ar')),
  telegram_chat_id bigint UNIQUE,
  notes       text,
  opted_out   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guests (lower(full_name));
CREATE INDEX ON guests (phone);
CREATE INDEX ON guests (lower(email));

-- ───────── Reservations ─────────
CREATE TABLE reservations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      text NOT NULL UNIQUE,
  guest_id       uuid NOT NULL REFERENCES guests(id),
  room_type_id   uuid NOT NULL REFERENCES room_types(id),
  check_in       date NOT NULL,
  check_out      date NOT NULL,
  guests_count   int NOT NULL CHECK (guests_count > 0),
  source         text NOT NULL CHECK (source IN ('website','telegram','staff','import')),
  status         text NOT NULL CHECK (status IN ('hold','pending','confirmed','checked_in','checked_out','cancelled','rejected','expired','no_show')),
  hold_expires_at timestamptz,
  total_cents    bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency       text NOT NULL DEFAULT 'EGP',
  price_breakdown jsonb NOT NULL DEFAULT '[]',
  policy_version text,
  policy_outcome jsonb,
  needs_review   boolean NOT NULL DEFAULT false,
  review_reason  text,
  staff_notes    text,
  guest_notes    text,
  cancelled_reason text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);
CREATE INDEX ON reservations (status);
CREATE INDEX ON reservations (check_in);
CREATE INDEX ON reservations (check_out);
CREATE INDEX ON reservations (guest_id);

CREATE TABLE reservation_units (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  unit_id        uuid NOT NULL REFERENCES units(id),
  during         daterange NOT NULL,              -- [check_in, check_out) : checkout day is free
  guests         int NOT NULL DEFAULT 1,
  active         boolean NOT NULL DEFAULT true,   -- false once cancelled/expired/checked out
  -- THE double-booking guard: no two active allocations of the same unit may overlap.
  CONSTRAINT no_double_booking EXCLUDE USING gist (unit_id WITH =, during WITH &&) WHERE (active)
);
CREATE INDEX ON reservation_units (reservation_id);

CREATE TABLE reservation_events (
  id             bigserial PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  actor          text NOT NULL,                   -- user email, 'guest', 'bot', 'system'
  action         text NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reservation_events (reservation_id, created_at);

-- ───────── Payments ─────────
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  amount_cents   bigint NOT NULL CHECK (amount_cents <> 0),   -- negative = refund
  method         text NOT NULL CHECK (method IN ('cash','bank_transfer','instapay','card_terminal','online_provider','other')),
  reference      text,
  status         text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','verified','rejected')),
  note           text,
  recorded_by    uuid REFERENCES users(id),
  verified_by    uuid REFERENCES users(id),
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON payments (reservation_id);

-- ───────── Stay extensions ─────────
CREATE TABLE extension_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES reservations(id),
  old_check_out   date NOT NULL,
  new_check_out   date NOT NULL,
  extra_nights    int NOT NULL,
  extra_cents     bigint NOT NULL,
  status          text NOT NULL CHECK (status IN ('pending','approved','rejected','applied','conflict','cancelled')),
  conflict_detail text,
  requested_by    text NOT NULL,                  -- 'telegram' | 'staff:<email>'
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (new_check_out > old_check_out)
);
CREATE INDEX ON extension_requests (reservation_id);
CREATE UNIQUE INDEX one_open_extension ON extension_requests (reservation_id) WHERE status IN ('pending','conflict');

-- ───────── Conversations (channel-agnostic: telegram now, whatsapp later) ─────────
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          text NOT NULL,                  -- 'telegram' | 'whatsapp'
  external_id      text NOT NULL,                  -- chat id on that channel
  guest_id         uuid REFERENCES guests(id),
  reservation_id   uuid REFERENCES reservations(id),
  language         text CHECK (language IN ('en','es','fr','ar')),
  flow             text NOT NULL DEFAULT 'idle',   -- idle|booking|availability|extension|lookup|language
  step             text NOT NULL DEFAULT 'start',
  data             jsonb NOT NULL DEFAULT '{}',    -- collected booking details etc.
  mode             text NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot','human')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','needs_staff','resolved')),
  assigned_to      uuid REFERENCES users(id),
  priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  escalation_reason text,
  missing_info     text,
  summary          text,
  recommended_action text,
  escalated_at     timestamptz,
  last_guest_message_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);
CREATE INDEX ON conversations (status, mode);

CREATE TABLE messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  direction       text NOT NULL CHECK (direction IN ('in','out')),
  sender          text NOT NULL CHECK (sender IN ('guest','bot','staff','system')),
  text            text NOT NULL,
  kind            text NOT NULL DEFAULT 'text',     -- text | voice
  external_msg_id text,
  delivery_status text NOT NULL DEFAULT 'sent',     -- sent | failed
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (conversation_id, created_at);

CREATE TABLE processed_updates (       -- idempotency for channel webhooks/polling
  channel   text NOT NULL,
  update_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, update_id)
);

-- ───────── Staff tasks ─────────
CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  detail          text,
  kind            text NOT NULL DEFAULT 'general',   -- review_booking | extension | payment | escalation | general
  reservation_id  uuid REFERENCES reservations(id),
  conversation_id uuid REFERENCES conversations(id),
  extension_id    uuid REFERENCES extension_requests(id),
  due_at          timestamptz,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  assigned_to     uuid REFERENCES users(id),
  dedupe_key      text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX ON tasks (status, due_at);

-- ───────── Automation ─────────
CREATE TABLE automation_rules (
  kind          text PRIMARY KEY,         -- e.g. incomplete_booking, pending_reminder, pre_arrival ...
  label         text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  delay_minutes int NOT NULL,             -- relative to the trigger event (or before arrival for pre_arrival etc.)
  max_attempts  int NOT NULL DEFAULT 3,
  retry_minutes int NOT NULL DEFAULT 15,
  max_per_day   int NOT NULL DEFAULT 2,   -- per-guest daily limit
  templates     jsonb NOT NULL DEFAULT '{}'  -- {"en": "...", "es": "...", ...}
);

CREATE TABLE scheduled_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL REFERENCES automation_rules(kind),
  conversation_id uuid REFERENCES conversations(id),
  reservation_id  uuid REFERENCES reservations(id),
  guest_id        uuid REFERENCES guests(id),
  run_at          timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','failed','skipped')),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  skip_reason     text,
  dedupe_key      text NOT NULL UNIQUE,   -- idempotency: same event never schedules twice
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON scheduled_messages (status, run_at);

-- ───────── Policy engine ─────────
CREATE TABLE policy_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  version      int NOT NULL DEFAULT 1,
  active       boolean NOT NULL DEFAULT false,   -- NOTHING is active until the owner confirms the rule
  conditions   jsonb NOT NULL DEFAULT '[]',      -- [{"field":"nationality","op":"eq","value":"EG"}]
  action       text NOT NULL CHECK (action IN ('ask','review','require_approval','inform')),
  questions    jsonb NOT NULL DEFAULT '[]',      -- extra questions the bot/website should ask
  message      jsonb NOT NULL DEFAULT '{}',      -- per-language text shown to the guest
  notes        text,
  updated_by   uuid REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ───────── Settings / audit / import ─────────
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (created_at DESC);

CREATE TABLE import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  status      text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','imported','failed')),
  mapping     jsonb NOT NULL DEFAULT '{}',
  original    bytea,                                  -- original file preserved
  total_rows  int NOT NULL DEFAULT 0,
  imported_rows int NOT NULL DEFAULT 0,
  rejected_rows int NOT NULL DEFAULT 0,
  report      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
