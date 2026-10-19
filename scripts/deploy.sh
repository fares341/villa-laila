#!/usr/bin/env bash
# Pulls the latest code from GitHub and rebuilds the site on the server.
# Run on the server:  bash scripts/deploy.sh   (GitHub Actions runs it on every push to main)
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/api/health}"

cd "$APP_DIR"
echo "==> Deploying $BRANCH in $APP_DIR"

# One deploy at a time
exec 9>/tmp/villa-laila-deploy.lock
flock -n 9 || { echo "Another deploy is running, exiting."; exit 0; }

[ -f .env ] || { echo "ERROR: .env missing in $APP_DIR (copy .env.example and fill it)."; exit 1; }

PREV=$(git rev-parse --short HEAD)
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"     # server copy always matches GitHub (.env, backups/ are untracked and kept)
NEW=$(git rev-parse --short HEAD)
echo "==> $PREV -> $NEW"

# Rebuild images, run migrations, restart web + worker (database volume is kept)
docker compose up -d --build --remove-orphans

echo "==> Waiting for the site to answer at $HEALTH_URL"
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> Live: $NEW"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 3
done

echo "ERROR: site did not become healthy. Last web logs:"
docker compose logs --tail=80 web || true
exit 1
