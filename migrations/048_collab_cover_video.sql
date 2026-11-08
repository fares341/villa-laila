-- Collab events: a video cover (plays silently at the top of the page; the photo covers stay for cards and shared links).
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS cover_video text;
