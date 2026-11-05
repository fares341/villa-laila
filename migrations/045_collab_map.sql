-- Collab events held somewhere else than the villa: the Google Maps link of the place (the written place stays in "place").
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS map_url text;
