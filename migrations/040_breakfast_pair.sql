-- Breakfast is two fixed meals (rows 0 and 1 of the breakfast menu). Breakfasts saved per weekday in the old version
-- are moved into those two places when they are empty, so both show without saving them again. Nothing is deleted.
DO $$
DECLARE r record; slot int;
BEGIN
  FOREACH slot IN ARRAY ARRAY[0, 1] LOOP
    IF NOT EXISTS (SELECT 1 FROM weekly_menu WHERE meal='breakfast' AND weekday=slot) THEN
      SELECT * INTO r FROM weekly_menu w
       WHERE w.meal='breakfast' AND w.weekday BETWEEN 2 AND 6
         AND NOT EXISTS (SELECT 1 FROM weekly_menu x WHERE x.meal='breakfast' AND x.weekday IN (0,1)
                          AND lower(coalesce(x.title->>'en', x.title->>'ar', '')) = lower(coalesce(w.title->>'en', w.title->>'ar', '')))
       ORDER BY w.weekday LIMIT 1;
      IF FOUND THEN
        INSERT INTO weekly_menu(meal, weekday, title, dishes, description, photo, photo_mime, image_url, updated_at)
        VALUES ('breakfast', slot, r.title, r.dishes, r.description, r.photo, r.photo_mime, r.image_url, now());
      END IF;
    END IF;
  END LOOP;
END $$;
