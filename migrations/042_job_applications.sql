-- "Join the team" on the website: job (receptionist) and volunteer applications, kept here (not in a Google Form).
CREATE TABLE IF NOT EXISTS job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'job',            -- job | volunteer
  full_name text NOT NULL,
  birth_date text,
  phone text NOT NULL,
  email text,
  languages text,
  experience text,
  why text,
  availability text[] NOT NULL DEFAULT '{}',   -- full_time / part_time
  rotating_shifts text,                        -- yes | no
  start_when text,
  stay_length text,                            -- volunteers: how long they can stay
  note text,
  lang text,
  status text NOT NULL DEFAULT 'new',          -- new | contacted | interview | accepted | declined
  staff_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_applications_created_idx ON job_applications(created_at DESC);
