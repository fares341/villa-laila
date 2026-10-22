-- Photos / video for the top of the event's own page ("hero"), separate from the cover photo used on the
-- event cards and when the link is shared.
ALTER TABLE event_media DROP CONSTRAINT IF EXISTS event_media_kind_check;
ALTER TABLE event_media ADD CONSTRAINT event_media_kind_check CHECK (kind IN ('meal','video','gallery','hero'));
