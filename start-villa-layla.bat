@echo off
title Villa Layla - Local Server & Bot
echo ========================================================
echo        Villa Layla Hostel - Local Server & Bot
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/3] Starting Local PostgreSQL Database...
start "PostgreSQL Server" /min node -e "import('embedded-postgres').then(m => { const pg = new m.default({ port: 5432, databaseDir: './.pgdata', user: 'villa', password: 'password', persistent: true }); pg.start().then(() => console.log('PG Ready')); });"
timeout /t 3 /nobreak >nul

echo [2/3] Starting Telegram Bot Worker (@villalayldbot)...
start "Telegram Bot Worker" npm run worker

echo [3/3] Starting Next.js Web Server & Dashboard...
start "Villa Layla Web Server" npm start

echo.
echo ========================================================
echo   Services are running!
echo   - Website:   http://localhost:3000
echo   - Dashboard: http://localhost:3000/dashboard/login
echo   - Telegram:  https://t.me/villalayldbot
echo ========================================================
echo.
pause
