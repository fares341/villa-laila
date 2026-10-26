-- Home page slider (videos at the top of the home page), edited in Dashboard → Website → Home slider.
CREATE TABLE IF NOT EXISTS site_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  video text NOT NULL,                 -- /videos/... or /api/media/site/...
  poster text,                         -- photo shown while the video loads
  label jsonb NOT NULL DEFAULT '{}',   -- {ar, en} big line
  sub jsonb NOT NULL DEFAULT '{}',     -- {ar, en} small line
  crumb jsonb NOT NULL DEFAULT '{}',   -- {ar, en} caption under the slider
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_slides(sort_order, video, poster, label, sub, crumb)
SELECT * FROM (VALUES
  (1, '/videos/hero-01.mp4', '/photos/gallery_and_hostel/jtfzrhhp3g0fj6vdnxjq.jpeg',
   '{"ar":"مسبح وحديقة الفيلا","en":"Garden pool & villa"}'::jsonb, '{"ar":"واحة في قلب السيدة زينب","en":"Oasis in El Sayeda Zeinab"}'::jsonb, '{"ar":"السيدة زينب · مسبح وحديقة هادئة","en":"El Sayeda Zeinab · Garden pool"}'::jsonb),
  (2, '/videos/hero-02.mp4?v=20261025b', '/photos/hero-02-poster.jpg?v=20261025b',
   '{"ar":"أجواء فيلا ليلى","en":"The villa vibes"}'::jsonb, '{"ar":"أركان استرخاء وتراس ساحر","en":"Terraces & lounges"}'::jsonb, '{"ar":"فيلا قاهرية تاريخية مرممة","en":"A restored Cairo villa"}'::jsonb),
  (3, '/videos/hero-03.mp4?v=20261025b', '/photos/hero-03-poster.jpg?v=20261025b',
   '{"ar":"غرف وأجنحة ملكية","en":"Rooms & royal stay"}'::jsonb, '{"ar":"عشر غرف خاصة لكل منها طابع","en":"10 unique named rooms"}'::jsonb, '{"ar":"شهرزاد · جناح كينج ملكي","en":"Sheherazade · King room"}'::jsonb)
) v(sort_order, video, poster, label, sub, crumb)
WHERE NOT EXISTS (SELECT 1 FROM site_slides);
