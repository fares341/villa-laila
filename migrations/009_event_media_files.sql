-- Large event videos are stored as files on the server (uploads volume), not inside the database.
ALTER TABLE event_media ADD COLUMN IF NOT EXISTS file_path text;      -- relative to UPLOAD_DIR
ALTER TABLE event_media ADD COLUMN IF NOT EXISTS size_bytes bigint;
ALTER TABLE event_media DROP CONSTRAINT IF EXISTS event_media_check;
ALTER TABLE event_media ADD CONSTRAINT event_media_source_check CHECK (bytes IS NOT NULL OR url IS NOT NULL OR file_path IS NOT NULL);
