# تشغيل المشروع على جهازك (Local)

## الطريقة الأسهل: Docker (ويندوز / ماك / لينكس)
1. نزّل وشغّل **Docker Desktop**.
2. فك الضغط عن الملف، وافتح Terminal جوه فولدر `villa-layla`.
3. انسخ ملف الإعدادات:
   - ماك/لينكس: `cp .env.example .env`
   - ويندوز (PowerShell): `copy .env.example .env`
4. افتح `.env` وغيّر:
   - `POSTGRES_PASSWORD` أي باسورد
   - `AUTH_SECRET` أي نص طويل (32 حرف أو أكتر)
   - `ADMIN_EMAIL` و `ADMIN_PASSWORD` (ده دخولك للداشبورد)
   - `PUBLIC_BASE_URL=http://localhost`
   - (اختياري) `TELEGRAM_BOT_TOKEN` و `TELEGRAM_BOT_USERNAME` و `OPENROUTER_API_KEY`
5. شغّل: `docker compose up -d --build`
6. افتح:
   - الموقع: http://localhost
   - الداشبورد: http://localhost/dashboard/login

للإيقاف: `docker compose down` — للّوجز: `docker compose logs -f web worker`

## من غير Docker (للمطورين)
محتاج Node.js 22 و PostgreSQL 16.
```bash
npm install
createdb villa                         # أو من pgAdmin
export DATABASE_URL=postgres://USER:PASS@localhost:5432/villa
export AUTH_SECRET=any-long-random-string-32chars-min
export ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=strongpassword SEED_DEMO=true
npm run migrate && npm run seed
npm run dev                            # الموقع على http://localhost:3000
npm run worker                         # في Terminal تاني: بوت تليجرام + المتابعات
```
(على ويندوز PowerShell استخدم `$env:DATABASE_URL="..."` بدل `export`.)

ملاحظة: الفويس نوت محتاج `ffmpeg` متسطب على الجهاز في وضع "من غير Docker" (في Docker متسطب لوحده).
