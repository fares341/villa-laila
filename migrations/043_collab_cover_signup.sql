-- Collab events: a cover photo of its own (top of the page, the card in the events list, shared links),
-- and where the tickets are taken: here (our form) or on another site (a button to that link).
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS cover text;
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS signup_mode text NOT NULL DEFAULT 'here';
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS signup_url text;
