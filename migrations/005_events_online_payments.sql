-- Events at Villa Layla (poolside breakfast, pool day, yoga, dinner, karaoke…),
-- their bookings/tickets, and online payments (Paymob + guest-submitted InstaPay transfers)
-- for both event tickets and room reservations.

CREATE TABLE IF NOT EXISTS events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           jsonb NOT NULL,                 -- {en, ar}
  summary         jsonb NOT NULL DEFAULT '{}',    -- one line {en, ar}
  description     jsonb NOT NULL DEFAULT '{}',    -- {en, ar}
  includes        jsonb NOT NULL DEFAULT '[]',    -- [{en, ar}]
  image           text,
  price_cents     bigint NOT NULL CHECK (price_cents >= 0),
  guest_price_cents bigint CHECK (guest_price_cents IS NULL OR guest_price_cents >= 0), -- price for in-house guests; NULL = no online discount
  currency        text NOT NULL DEFAULT 'EGP',
  start_time      text NOT NULL,                  -- 'HH:MM' Cairo time
  end_time        text NOT NULL,
  recurrence      text NOT NULL CHECK (recurrence IN ('daily','weekly','once')),
  weekdays        int[] NOT NULL DEFAULT '{}',    -- 0=Sun … 6=Sat (weekly)
  once_date       date,                           -- for 'once'
  ends_on         date,                           -- optional last date for repeating events
  capacity        int CHECK (capacity IS NULL OR capacity > 0), -- per date; NULL = unlimited
  options         jsonb NOT NULL DEFAULT '[]',    -- choices the guest must pick, e.g. breakfast type [{key,en,ar}]
  pay_methods     text[] NOT NULL DEFAULT '{paymob,instapay}', -- paymob | instapay | cash
  note            jsonb NOT NULL DEFAULT '{}',    -- extra info {en, ar}
  active          boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (recurrence <> 'once' OR once_date IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS event_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code     text NOT NULL UNIQUE,
  event_id        uuid NOT NULL REFERENCES events(id),
  event_date      date NOT NULL,
  quantity        int NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  option_key      text,
  is_hotel_guest  boolean NOT NULL DEFAULT false,
  stay_reference  text,
  full_name       text NOT NULL,
  email           text NOT NULL,
  phone           text,
  language        text NOT NULL DEFAULT 'en',
  unit_price_cents bigint NOT NULL,
  total_cents     bigint NOT NULL CHECK (total_cents >= 0),
  currency        text NOT NULL DEFAULT 'EGP',
  pay_method      text NOT NULL CHECK (pay_method IN ('paymob','instapay','cash')),
  -- awaiting_payment: sent to Paymob, not paid yet (released after 30 min)
  -- pending_verification: guest says they sent InstaPay, staff must check the app
  -- paid: money received (Paymob confirmed, or staff verified InstaPay/cash)
  -- pay_on_site: ticket reserved, pays cash at the door
  status          text NOT NULL CHECK (status IN ('awaiting_payment','pending_verification','paid','pay_on_site','cancelled','expired')),
  hold_expires_at timestamptz,                    -- awaiting_payment seats are released after this
  checked_in_at   timestamptz,
  paid_at         timestamptz,
  staff_note      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_bookings_date_idx ON event_bookings(event_id, event_date);
CREATE INDEX IF NOT EXISTS event_bookings_status_idx ON event_bookings(status);

-- One row per payment attempt that did NOT come from staff: Paymob checkouts and guest-submitted InstaPay transfers.
-- A Paymob row becomes 'paid' only from a callback whose HMAC verifies. An InstaPay row stays 'submitted'
-- until a manager checks the InstaPay app and verifies it in the dashboard.
CREATE TABLE IF NOT EXISTS online_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_ref    text NOT NULL UNIQUE,           -- sent to Paymob as special_reference
  kind            text NOT NULL CHECK (kind IN ('room','event')),
  reservation_id  uuid REFERENCES reservations(id),
  event_booking_id uuid REFERENCES event_bookings(id),
  provider        text NOT NULL CHECK (provider IN ('paymob','instapay')),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  currency        text NOT NULL DEFAULT 'EGP',
  status          text NOT NULL CHECK (status IN ('created','paid','failed','submitted','verified','rejected')),
  provider_order_id text,
  provider_txn_id text,
  payer_name      text,
  payer_reference text,                           -- InstaPay transaction reference / sender handle typed by the guest
  raw             jsonb,
  verified_by     uuid REFERENCES users(id),
  verified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'room' AND reservation_id IS NOT NULL) OR (kind = 'event' AND event_booking_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS online_payments_status_idx ON online_payments(provider, status);
CREATE INDEX IF NOT EXISTS online_payments_order_idx ON online_payments(provider_order_id);

-- Seed: events from events.villalaylahostel.com (2026-10-19). Prices in piastres (EGP × 100).
INSERT INTO events (slug,title,summary,description,includes,image,price_cents,guest_price_cents,start_time,end_time,recurrence,weekdays,once_date,capacity,options,pay_methods,note,active,sort_order) VALUES
('poolside-breakfast',
 '{"en":"Poolside Breakfast","ar":"فطور بجانب المسبح"}',
 '{"en":"Egyptian or Western breakfast in the garden","ar":"فطور مصري أو غربي في الحديقة"}',
 '{"en":"Start your morning in a hidden oasis in the heart of Cairo. Whether you’re a traveler, expat or local, come enjoy an Egyptian or Western breakfast by the pool at Villa Layla, surrounded by greenery, sunshine and a peaceful atmosphere. The perfect escape from the city’s hustle.","ar":"ابدأ صباحك في واحة مخفية في قلب القاهرة. سواء كنت مسافرًا أو مقيمًا أو من أهل البلد، استمتع بفطور مصري أو غربي بجانب المسبح في فيلا ليلى وسط الخضرة والشمس والهدوء، بعيدًا عن زحمة المدينة."}',
 '[{"en":"Egyptian or Western breakfast","ar":"فطور مصري أو غربي"},{"en":"Garden & pool setting","ar":"جلسة في الحديقة بجانب المسبح"}]',
 '/photos/events/poolside-breakfast.webp', 20000, NULL, '08:00','11:00','daily','{}',NULL, NULL,
 '[{"key":"egyptian","en":"Egyptian breakfast","ar":"فطور مصري"},{"key":"western","en":"Western breakfast","ar":"فطور غربي"}]',
 '{paymob,instapay,cash}', '{"en":"Staying at the villa? Ask reception about the guest price.","ar":"مقيم في الفيلا؟ اسأل الاستقبال عن سعر النزلاء."}', true, 10),

('pool-day',
 '{"en":"Pool Day","ar":"يوم في المسبح"}',
 '{"en":"Day pass to the garden pool","ar":"تذكرة يوم كامل للمسبح والحديقة"}',
 '{"en":"A hidden oasis in the heart of Cairo. Escape the busy streets and spend a relaxing day by the pool at Villa Layla Hostel.","ar":"واحة مخفية في قلب القاهرة. اهرب من زحمة الشوارع وقضِّ يومًا هادئًا بجانب المسبح في فيلا ليلى."}',
 '[{"en":"Pool access","ar":"دخول المسبح"},{"en":"Showers & changing rooms","ar":"دُش وغرف تبديل"},{"en":"Towel","ar":"فوطة"},{"en":"Free coffee & tea","ar":"قهوة وشاي مجانًا"},{"en":"Relaxing pool area","ar":"منطقة استرخاء حول المسبح"}]',
 '/photos/events/pool-day.webp', 40000, NULL, '09:00','18:00','daily','{}',NULL, NULL,
 '[]', '{paymob,instapay}', '{}', true, 20),

('mat-to-mate-by-the-pool',
 '{"en":"Mat to Mate by the Pool","ar":"يوغا وتعارف بجانب المسبح"}',
 '{"en":"Yoga by the pool, then coffee & new friends","ar":"يوغا بجانب المسبح ثم قهوة وتعارف"}',
 '{"en":"Start on the mat. End with a mate. A relaxed evening by the pool combining movement, good vibes and meeting new people. 6:00–7:00 PM yoga by the pool led by ELA Yoga Studio, suitable for all levels. 7:00–8:00 PM coffee & connections. Everyone is welcome, no experience needed. Mats are available, or bring your own; wear comfortable clothes. Changing rooms and showers on site.","ar":"تبدأ على المات وتنتهي مع صحبة جديدة. أمسية هادئة بجانب المسبح تجمع الحركة والطاقة الحلوة والتعارف. من 6 لـ 7 مساءً يوغا بجانب المسبح مع ELA Yoga Studio تناسب كل المستويات، ومن 7 لـ 8 قهوة وشاي وتعارف. الكل مرحّب به ولا يلزم خبرة سابقة. المات متوفر أو أحضر الخاص بك، والبس ملابس مريحة. يوجد غرف تبديل ودُش."}',
 '[{"en":"60 min yoga with ELA Yoga Studio","ar":"60 دقيقة يوغا مع ELA Yoga Studio"},{"en":"Coffee & tea after the session","ar":"قهوة وشاي بعد الجلسة"},{"en":"Mats available","ar":"مات يوغا متوفر"}]',
 '/photos/events/mat-to-mate-by-the-pool.webp', 30000, NULL, '18:00','20:00','weekly','{3,6}',NULL, NULL,
 '[]', '{paymob,instapay,cash}', '{"en":"Hostel guests: pay what you want, on site after the session.","ar":"نزلاء الفيلا: ادفع ما تحب في المكان بعد الجلسة."}', true, 30),

('poolside-dinner-2',
 '{"en":"Poolside Dinner","ar":"عشاء بجانب المسبح"}',
 '{"en":"Homemade Egyptian dinner by the pool","ar":"عشاء مصري بيتي بجانب المسبح"}',
 '{"en":"Join us by the pool for a relaxed homemade dinner at Villa Layla. Today’s dish: beef & onion tagen, vermicelli rice, orzo soup and a fresh Egyptian salad. Come hungry, find a seat, enjoy good food and meet new people.","ar":"انضم إلينا بجانب المسبح لعشاء بيتي هادئ في فيلا ليلى. طبق اليوم: طاجن لحمة بالبصل، رز بالشعرية، شوربة لسان عصفور، وسلطة مصرية طازة. تعالَ جعان، اقعد، كُل أكل حلو وتعرّف على ناس جديدة."}',
 '[{"en":"Main dish, rice, soup & salad","ar":"طبق رئيسي ورز وشوربة وسلطة"}]',
 '/photos/events/poolside-dinner-2.webp', 30000, NULL, '16:00','20:00','weekly','{1,2,3,4,5,6}',NULL, NULL,
 '[]', '{paymob,instapay,cash}', '{"en":"The dish changes; reception will tell you the menu of the day.","ar":"الطبق بيتغير، والاستقبال يقولك منيو اليوم."}', true, 40),

('karaoke-night-by-the-pool',
 '{"en":"Karaoke Night by the Pool","ar":"ليلة كاريوكي بجانب المسبح"}',
 '{"en":"Your song, your stage, zero judgment","ar":"أغنيتك، مسرحك، ومن غير أحكام"}',
 '{"en":"From bathroom singer to poolside superstar! Grab the mic, pick your favourite song and sing your heart out. Doors open 5:00 PM, karaoke starts 6:00 PM, ends 9:00 PM. Free coffee & tea, poolside vibes and new friends. No talent required.","ar":"من مطرب الحمّام لنجم المسبح! امسك المايك واختار أغنيتك المفضلة وغنّي من قلبك. الأبواب تفتح 5 مساءً، الكاريوكي يبدأ 6 وينتهي 9. قهوة وشاي مجانًا، وأجواء المسبح، وأصحاب جداد. مش محتاج موهبة."}',
 '[{"en":"Free coffee & tea","ar":"قهوة وشاي مجانًا"},{"en":"Mic & screen","ar":"مايك وشاشة"}]',
 '/photos/events/karaoke-night-by-the-pool.webp', 20000, NULL, '17:00','21:00','once','{}','2026-10-19', NULL,
 '[]', '{paymob,instapay,cash}', '{}', true, 50),

('mat-to-mate-by-the-pool-2',
 '{"en":"Mat to Mate by the Pool","ar":"يوغا وتعارف بجانب المسبح"}',
 '{"en":"Past session","ar":"جلسة سابقة"}',
 '{"en":"Past edition of Mat to Mate.","ar":"نسخة سابقة من يوغا وتعارف."}',
 '[]', '/photos/events/mat-to-mate-by-the-pool-2.webp', 30000, NULL, '18:00','20:00','once','{}','2026-10-08', NULL,
 '[]', '{paymob,instapay,cash}', '{}', false, 90),

('poolside-dinner',
 '{"en":"Poolside Dinner","ar":"عشاء بجانب المسبح"}',
 '{"en":"Past dinner","ar":"عشاء سابق"}',
 '{"en":"Past edition: mushroom soup, macarona béchamel, breaded chicken, rice and salad.","ar":"نسخة سابقة: شوربة مشروم، مكرونة بشاميل، فراخ بانيه، رز وسلطة."}',
 '[]', '/photos/events/poolside-dinner.webp', 30000, NULL, '15:00','20:00','once','{}','2026-10-07', NULL,
 '[]', '{paymob,instapay,cash}', '{}', false, 91)
ON CONFLICT (slug) DO NOTHING;
