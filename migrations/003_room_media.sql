-- Real room content: photos and structured details (bed type, bathroom, view, sleeps).
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]';
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS source_ref text;   -- id on the hostel's previous booking site, for traceability
