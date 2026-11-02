-- Collab events: extra questions on the ticket form, the entry price (free / pay what you want / fixed),
-- and invitations sent by e-mail to past guests (with an opt-out list).
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS questions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'free';
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS price_cents int;
ALTER TABLE collab_rsvps ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE collab_rsvps ADD COLUMN IF NOT EXISTS offer_cents int;

CREATE TABLE IF NOT EXISTS collab_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collab_id uuid NOT NULL REFERENCES collabs(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'sent',   -- sent | failed
  error text,
  sent_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collab_id, email)
);
CREATE TABLE IF NOT EXISTS email_optouts (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
