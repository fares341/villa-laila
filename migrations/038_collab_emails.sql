-- Collab events: the e-mail addresses that get a message for every sign-up (ours and the partner's, chosen in the dashboard).
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS notify_emails text[] NOT NULL DEFAULT '{}';
