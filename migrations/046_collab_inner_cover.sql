-- Collab events: a second cover for the top of the event page ("inside"); "cover" stays the card / shared-link photo ("outside").
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS inner_cover text;
