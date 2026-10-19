# Villa Layla Hostel — Booking Platform

One backend, three surfaces: public website (EN/ES/FR/AR-RTL), English staff dashboard (`/dashboard`), Telegram AI booking assistant (voice notes via Gemini). WhatsApp can be added later through the `ChannelAdapter` interface (`src/services/channels.ts`).

## Quick start on a VPS (Docker)
1. Install Docker + Compose plugin on the VPS, copy this folder to it.
2. `cp .env.example .env` and edit: `POSTGRES_PASSWORD`, `AUTH_SECRET` (`openssl rand -hex 32`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_BASE_URL`.
   - Test by IP: `SITE_ADDRESS=:80`, `PUBLIC_BASE_URL=http://SERVER_IP`.
   - Real domain: `SITE_ADDRESS=yourdomain.com`, `PUBLIC_BASE_URL=https://yourdomain.com` (Caddy gets HTTPS automatically; DNS A record must point to the server).
3. `docker compose up -d --build`
4. Open `http://SERVER_IP/` (site) and `/dashboard/login` (staff). Log in with ADMIN_EMAIL / ADMIN_PASSWORD, then change the password.
5. Health: `/api/health`. Logs: `docker compose logs -f web worker`.

`SEED_DEMO=true` loads rooms/beds/prices clearly labelled **DEMO** (250/270/800 EGP are NOT real). Set `SEED_DEMO=false` and enter real data in Dashboard → Rooms before launch. `SHOW_UNVERIFIED_CONTENT=true` shows garden/pool/etc. badged "to be confirmed"; set false for launch until owner confirms.

## Telegram bot + voice notes
1. In Telegram, talk to @BotFather → `/newbot` → copy the token.
2. Put in `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (no @) and `OPENROUTER_API_KEY` (from openrouter.ai). `OPENROUTER_MODEL` defaults to `google/gemini-2.5-flash`; keep a model that accepts audio input, or voice notes will fail. (`GEMINI_API_KEY` is only used if no OpenRouter key is set.)
3. Optional staff alerts: add the bot to a staff group/chat, send a message, get the chat id (e.g. via `https://api.telegram.org/bot<TOKEN>/getUpdates`), set `TELEGRAM_STAFF_CHAT_ID`.
4. `docker compose up -d` (recreates web/worker). The `worker` service long-polls Telegram — no webhook or public URL needed.
5. Dashboard → Settings → Integrations shows whether each key is detected.

Voice notes: the voice message (converted to MP3 by ffmpeg, included in the Docker image) is transcribed by the AI model via OpenRouter, the language is detected (if it is a first message, the conversation language is set from it; if undetected, the bot shows language buttons and keeps the text), the bot echoes "🎤 I understood: …" so the guest can correct it, then continues as text.

> The Telegram and Gemini integrations were **not tested live** (no credentials were available when building). Everything else (booking engine, state machine, hand-off, follow-ups) is covered by automated tests with Telegram/Gemini mocked. Expect to do a first live test and report anything odd.

## How booking works (rules the code enforces)
- Website and bot create **pending** reservations (a timed hold, default 48h). Only staff **confirm**. The bot never says "confirmed" unless the backend did.
- No double-booking: Postgres exclusion constraint + per-room-type advisory lock (tested with 8 concurrent attempts → 1 winner).
- Payments are "recorded" until a manager/owner **verifies** them. A guest message/screenshot never marks anything paid. No card data stored.
- Extensions: guest asks → request created → staff approve/reject → re-validated at decision time.
- Human hand-off: staff "Take over" in Inbox stops the bot for that chat until "Resume bot".
- Policy engine (Settings → Policy rules). Two **active** rules are seeded from the owner's instruction (edit/deactivate in Settings; wording is a draft to confirm):
  1. Egyptian nationals cannot book a **mixed** dorm (rooms have a Gender field: mixed/female/male — set it in Dashboard → Rooms).
  2. Egyptian national ID issued in **Cairo / Giza / Qalyubia** → cannot stay at all.
  The website and bot ask Egyptian guests for the ID governorate, refuse blocked requests with a clear message (bot refuses early, before the form is filled), and send unknown cases to staff review. Staff-created bookings are allowed but flagged. Covered by `tests/egyptian-policy.test.ts`.
- Roles: owner / manager / receptionist (see `src/lib/permissions.ts`). Audit log for sensitive actions.

## Excel/CSV import
Dashboard → Import: upload → map columns → preview (duplicates/overlaps/errors flagged) → commit. Original file is stored; rejected rows can be downloaded.

## Backups / restore
A daily `pg_dump` is written to `./backups/villa-DATE.sql.gz` (kept 14 days). Restore: stop web/worker, then `gunzip -c backups/villa-DATE.sql.gz | docker compose exec -T db psql -U villa villa`.

## Tests (local)
Needs a Postgres: `DATABASE_URL=postgres://... npx vitest run` → 63 tests.

## Implemented vs NOT implemented
Implemented: everything above, 4-language site, calendar (day/week/month), reports, automation/follow-ups with per-guest daily limit and opt-out, CSV export (formula-injection safe), settings editor, FAQ editor.
Not implemented / limitations:
- WhatsApp adapter (design ready, not built).
- Live Telegram/Gemini not verified; Docker build not run in the authoring environment (app built and ran against Postgres 16 directly).
- Early check-out does not free remaining nights; calendar has no drag-and-drop; login rate-limit is in-memory per process.
- Photos are hotlinked from the hostel's own CDNs; hostel facts (amenities, address, hours, policies) are NOT filled — marked "to be confirmed".

## Prices, rooms, Instagram
- **Rooms are real**: the 15 room types (10 named private rooms + 5 dorms), descriptions, bed types, bathrooms, views and photos come from the hostel's own website feed (`/api/rooms`) — see `src/content/rooms-catalog.ts`. Dorm bed counts come from the dorm names. Hostel facts (address, WhatsApp, email, hours, breakfast, pool, tours) come from the same site.
- **Prices**: the hostel's site publishes only ONE price (18 for the Spacious 8-bed male dorm, currency not shown — USD assumed). With `SEED_DEMO=true` every other room gets a price marked "Sample price" on the site. Replace them in Dashboard → Rooms & rates.
- Photos are hotlinked from the hostel's image CDN; editable per room in Dashboard → Rooms (Photo URLs). Enter the real ones in Dashboard → Rooms & rates; the website and bot then show live availability and mark a room type **sold out automatically** when no bed/room is free (same database as the dashboard).
- Guest videos: Dashboard → Settings → Guest videos takes up to 3 links (Instagram reel, TikTok, YouTube Short or .mp4) and shows them on the homepage under "Filmed by our guests". Earlier note: guest videos could not be pulled automatically (Instagram blocks it, and guests' videos need their permission). Homepage has an Instagram section: put approved post/reel URLs in `INSTAGRAM_POST_URLS` (comma-separated) and they are embedded via Instagram's official embed.

## Owner must provide
Real room/bed inventory and prices; check-in/out times; address and map; deposit/payment methods and instructions; cancellation and house rules (per language); Egyptian-guest policy (if any); real photos; FAQ answers; Telegram/Gemini credentials; domain.

## Demo checklist
1. Site in 4 languages (AR is RTL) → make a booking → see it pending in Dashboard → Reservations.
2. Confirm it (staff) → guest gets a Telegram notification if booked via bot.
3. Telegram: send text, then a voice note as first message in another language.
4. Inbox: take over a chat, reply, resume bot.
5. Payments: record then verify. Extensions: request and approve.
6. Import a sample Excel.
