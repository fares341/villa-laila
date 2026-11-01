-- Collaboration events: an event made with a partner (their logo and name next to ours), its own page to share on
-- Instagram stories, and a simple sign-up list (who is coming).
CREATE TABLE IF NOT EXISTS collabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  partner_name text NOT NULL,
  partner_logo text,
  partner_link text,
  title jsonb NOT NULL DEFAULT '{}'::jsonb,
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_date date,
  start_time text,
  end_time text,
  place jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_note jsonb NOT NULL DEFAULT '{}'::jsonb,
  capacity int,
  accent text NOT NULL DEFAULT '#D29A45',
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  meals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ask_email boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collab_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collab_id uuid NOT NULL REFERENCES collabs(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  people int NOT NULL DEFAULT 1,
  note text,
  instagram text,
  status text NOT NULL DEFAULT 'going',
  checked_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collab_rsvps_collab ON collab_rsvps(collab_id, created_at);
