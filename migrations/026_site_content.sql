-- Website management (dashboard → Website): day trips and guest films are edited from the dashboard.
-- Room photos stay in room_types.photos (uploads are served from /api/media/site/...).

CREATE TABLE IF NOT EXISTS site_tours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  name jsonb NOT NULL DEFAULT '{}',         -- {ar, en}
  duration jsonb NOT NULL DEFAULT '{}',     -- {ar, en}
  tag jsonb NOT NULL DEFAULT '{}',          -- {ar, en} badge on the card
  included jsonb NOT NULL DEFAULT '{}',     -- {ar: [...], en: [...]}
  excluded jsonb NOT NULL DEFAULT '{}',     -- {ar, en}
  image text,                               -- /photos/... or /api/media/site/...
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_films (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('main','reel')),   -- main = the wide film; reel = portrait reels
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  video text NOT NULL,                      -- /videos/... or /api/media/site/...
  poster text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Start from what the website shows today (only if empty, so a re-run never duplicates).
INSERT INTO site_tours(sort_order, name, duration, tag, included, excluded, image)
SELECT * FROM (VALUES
(1, '{"ar":"أهرامات الجيزة وسقارة وميت رهينة","en":"Pyramids of Giza, Saqqara & Memphis"}'::jsonb, '{"ar":"٧–٨ ساعات · تبدأ 8:30 ص","en":"7–8 hrs · Starts 8:30 AM"}'::jsonb, '{"ar":"الأكثر طلباً","en":"Most booked"}'::jsonb, '{"ar":["أهرامات الجيزة الثلاثة وأبو الهول والبانوراما","سقارة وهرم زوسر وهرم تيتي وأوناس (دخول أوناس مجاناً)","ميت رهينة أول عاصمة لمصر ومتحف رمسيس الثاني المفتوح","سيارة خاصة مكيفة وانتقالات كاملة من الفيلا"],"en":["Three Pyramids of Giza & Great Sphinx","Saqqara step pyramid, Titi & Unas (Free entry to Unas!)","Memphis & open-air King Ramses II museum","Private A/C transport & pickup from villa"]}'::jsonb, '{"ar":"لا يشمل: تذاكر دخول المزارات","en":"Exclude: The entrance fees"}'::jsonb, '/photos/gallery_and_hostel/grand.avif'),
(2, '{"ar":"سفاري الصحراء السوداء والبيضاء","en":"The Black & White Desert Safari"}'::jsonb, '{"ar":"يومان / ليلة واحدة","en":"2 days / 1 night"}'::jsonb, '{"ar":"مغامرة وتخييم","en":"Adventure & Camping"}'::jsonb, '{"ar":["انتقال مبكر للواحات البحرية والغداء بالقرية","سفاري جيب 4x4 للصحراء السوداء وجبل الكريستال وصخور المشروم","كثبان العقبات وتزلج الرمال والعيون الكبريتية الحارة والباردة","تخييم كامل بالصحراء البيضاء الجديدة مع عشاء المشويات والإفطار"],"en":["Early morning pickup to Bahariya oasis & village lunch","4x4 Jeep to Black Desert, Crystal Mountain & Mushroom rocks","Agabat sand dunes, sandboarding & cold/hot springs","Camping at New White Desert with BBQ dinner & breakfast"]}'::jsonb, '{"ar":"لا يشمل: تذاكر الدخول","en":"Exclude: The entrance fees"}'::jsonb, '/photos/gallery_and_hostel/white-dessert-egypt.png'),
(3, '{"ar":"الإسكندرية عروس البحر المتوسط","en":"Alexandria Day Trip"}'::jsonb, '{"ar":"يوم كامل","en":"Full day"}'::jsonb, '{"ar":"رحلة ساحلية","en":"Day trip"}'::jsonb, '{"ar":["مكتبة الإسكندرية الصرح الثقافي العالمي","مقابر كوم الشقافة الرومانية التاريخية","قلعة قايتباي الأثرية على البحر مباشرة","عمود السواري وسيارة خاصة مكيفة وانتقالات مريحة"],"en":["Bibliotheca Alexandrina (Alexandria Library)","Catacombs of Kom El Shoqafa","Historic Citadel of Qaitbay by the sea","Pompey’s Pillar & comfortable private A/C car"]}'::jsonb, '{"ar":"لا يشمل: تذاكر الدخول","en":"Exclude: Entrance fees"}'::jsonb, '/photos/gallery_and_hostel/Qaitbay_Citadel.jpg'),
(4, '{"ar":"سهرة العشاء النيلي الفاخر","en":"Nile Dinner Cruise"}'::jsonb, '{"ar":"ساعتان إبحار","en":"2 hours"}'::jsonb, '{"ar":"سهرة نيلية","en":"Evening cruise"}'::jsonb, '{"ar":["إبحار ساعتان في النيل مع بوفيه عشاء مفتوح فاخر","موسيقى حية وتخت شرقي أصيل","عروض تنورة صوفية ورقص شرقي فلكلوري","شاملة تذاكر الدخول وسيارة خاصة مع سائق ذهاباً وإياباً"],"en":["2-hour Nile cruise with luxury open buffet dinner","Live oriental music performance","Authentic Sufi Tanoura dance & belly dance show","Entrance fees and private car with driver included"]}'::jsonb, '{"ar":"لا يشمل: المشروبات والمياه","en":"Exclude: Drinks and water"}'::jsonb, '/photos/gallery_and_hostel/cairo-city.jpg'),
(5, '{"ar":"جولة القاهرة القديمة ومتحف الحضارة","en":"Old Cairo & Civilization Museum Tour"}'::jsonb, '{"ar":"يوم كامل","en":"Full day tour"}'::jsonb, '{"ar":"تاريخ وتراث","en":"Heritage & History"}'::jsonb, '{"ar":["القاهرة القبطية: كنيسة المغارة (أبي سرجة) والكنيسة المعلقة","القاهرة الإسلامية: قلعة صلاح الدين الأيوبي وجامع محمد علي","المتحف القومي للحضارة المصرية (NMEC) وقاعة المومياوات","سيارة خاصة مكيفة مع مرشد سياحي وانتقالات الفندق"],"en":["Coptic: The Cavern Church (Abu Serga) & The Hanging Church","Islamic: Citadel of Salah El Din & Mohamed Ali Mosque","National Museum of Egyptian Civilization (NMEC)","Private A/C vehicle & licensed guide"]}'::jsonb, '{"ar":"لا يشمل: تذاكر الدخول","en":"Exclude: Entrance fees"}'::jsonb, '/photos/gallery_and_hostel/Sultan_Hassan_Mosque___Madrasa.jpg'),
(6, '{"ar":"مغامرة واحة الفيوم وسفاري وادي الحيتان","en":"Fayoum Oasis & Safari Day Trip"}'::jsonb, '{"ar":"يوم كامل","en":"Day trip"}'::jsonb, '{"ar":"طبيعة وسفاري","en":"Nature & Safari"}'::jsonb, '{"ar":["وادي الريان والشلالات وجبل المدورة البانورامي","تزلج على الرمال الناعمة في الكثبان الذهبية (Sandboarding)","سفاري وادي الحيتان (موقع تراث عالمي) والبحيرة المسحورة","زيارة قرية تونس ومدارس الفخار التقليدية + وجبة غداء طازجة"],"en":["Wadi El Rayan waterfalls & panoramic Mudawara hills","Sandboarding on golden desert dunes","Safari to Valley of Whales (Wadi El Hitan) & Magic Lake","Tunis Village & pottery schools visit + Fresh local Lunch"]}'::jsonb, '{"ar":"لا يشمل: تذاكر الدخول","en":"Exclude: Entrance fees"}'::jsonb, '/photos/gallery_and_hostel/fayoum-magic-lake.jpg')
) v(sort_order, name, duration, tag, included, excluded, image)
WHERE NOT EXISTS (SELECT 1 FROM site_tours);

INSERT INTO site_films(kind, sort_order, video, poster)
SELECT * FROM (VALUES
  ('main', 0, '/videos/films/film-5.mp4', '/photos/films/film-5-poster.jpg'),
  ('reel', 1, '/videos/films/film-0.mp4', '/photos/films/film-0-poster.jpg'),
  ('reel', 2, '/videos/films/film-1.mp4', '/photos/films/film-1-poster.jpg'),
  ('reel', 3, '/videos/films/film-2.mp4', '/photos/films/film-2-poster.jpg'),
  ('reel', 4, '/videos/films/film-3.mp4', '/photos/films/film-3-poster.jpg'),
  ('reel', 5, '/videos/films/film-4.mp4', '/photos/films/film-4-poster.jpg')
) v(kind, sort_order, video, poster)
WHERE NOT EXISTS (SELECT 1 FROM site_films);
