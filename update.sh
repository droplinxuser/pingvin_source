#!/usr/bin/env bash
#
# Live update script for the Pingvin deployment at /var/www/pingvin_source.
#
#   - pulls the latest code from origin/main (fast-forward only)
#   - reinstalls dependencies and rebuilds backend + frontend
#   - restarts pingvin-back.service (which runs prisma migrate deploy + seed
#     on start) and then pingvin-front.service
#
# Usage (as root):
#   sudo bash /var/www/pingvin_source/update.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
SRC_DIR="$(pwd -P)"
DATA_DIR="/var/www/pingvin_data"
DB_URL="file:$DATA_DIR/pingvin-share.db?connection_limit=1"

[ "$(id -u)" -eq 0 ] || { echo "Error: run as root" >&2; exit 1; }

echo "==> Pulling latest code"
git checkout main
# Older builds rewrote public/manifest.json with the configured site name;
# restore it so the pull below can never conflict (the file was replaced by
# a dynamic route in pages/manifest.json.tsx).
git checkout -- frontend/public/manifest.json 2>/dev/null || true
# Admin-uploaded branding overwrites tracked files. Preserve only locally
# modified assets so the pull can fast-forward without discarding branding.
BRAND_BACKUP=""
if [ -d frontend/public/img ] && ! git diff --quiet -- frontend/public/img; then
  BRAND_BACKUP="$(mktemp -d)"
  cp -a frontend/public/img "$BRAND_BACKUP/img"
  git checkout -- frontend/public/img 2>/dev/null || true
fi
FAVICON_BACKUP=""
if [ -f frontend/public/favicon.ico ] && ! git diff --quiet -- frontend/public/favicon.ico; then
  FAVICON_BACKUP="$(mktemp)"
  cp -a frontend/public/favicon.ico "$FAVICON_BACKUP"
  git checkout -- frontend/public/favicon.ico 2>/dev/null || true
fi
restore_branding() {
  if [ -n "$BRAND_BACKUP" ]; then
    # Merge over the pulled tree so new tracked assets (WebP logos, PWA icon
    # variants, og-image.png) survive an update.
    cp -a "$BRAND_BACKUP/img/." frontend/public/img/
    rm -rf "$BRAND_BACKUP"
    BRAND_BACKUP=""
    # Older logo uploads wrote this file; the runtime uses the root favicon.
    rm -f frontend/public/img/favicon.ico
  fi
  if [ -n "$FAVICON_BACKUP" ]; then
    cp -a "$FAVICON_BACKUP" frontend/public/favicon.ico
    rm -f "$FAVICON_BACKUP"
    FAVICON_BACKUP=""
  fi
}
trap restore_branding EXIT
# backend/.env used to be tracked and is now ignored. Keep the server copy
# (which may contain local values) safe across the pull that removes it from
# the index: back it up, drop local modifications so the pull cannot refuse,
# and restore it afterwards. The trap also restores it when the pull fails.
ENV_BACKUP=""
restore_env() {
  if [ -n "$ENV_BACKUP" ]; then
    cp -p "$ENV_BACKUP" backend/.env
    rm -f "$ENV_BACKUP"
    ENV_BACKUP=""
  fi
}
trap 'restore_branding; restore_env' EXIT
if [ -f backend/.env ]; then
  ENV_BACKUP="$(mktemp)"
  cp backend/.env "$ENV_BACKUP"
  git checkout -- backend/.env 2>/dev/null || true
fi
git pull --ff-only
restore_env
restore_branding
trap - EXIT
# An untracked manifest.json from older builds would shadow the dynamic route.
rm -f frontend/public/manifest.json

# Re-exec the freshly pulled version of this script so the remainder always
# runs the up-to-date code (the pull may have updated this file itself).
if [ "${UPDATE_RERUN:-0}" != "1" ]; then
  UPDATE_RERUN=1 exec bash "$0"
fi

echo "==> Installing and building the backend"
cd "$SRC_DIR/backend"
npm ci --no-audit --no-fund
npm run build

echo "==> Installing and building the frontend"
cd "$SRC_DIR/frontend"
# Stop the frontend before rebuilding it. While `npm ci` and `next build`
# replace node_modules and .next, a running instance keeps serving HTML that
# references chunks which no longer exist on disk; those transient 404/400
# responses were being cached at the CDN as immutable, which broke client
# hydration (for example the upload dialog) until the cache was purged.
# Stopping first means the edge sees a connection error, which is never cached.
systemctl stop pingvin-front.service 2>/dev/null || true
npm ci --no-audit --no-fund
# Remove generated workers and the previous build before rebuilding. Stale
# chunk or worker files under public/ would otherwise stay publicly reachable
# with an old bundle (and old branding) after a deploy.
rm -f public/worker-*.js public/workbox-*.js public/sw.js public/sw.js.map
rm -rf .next
# Rebuild WebP logos/icons and the OG image from the restored branding (or the
# tracked defaults) after dependencies are installed.
npm run assets:brand
# The PWA manifest is served dynamically at /manifest.json with the site name
# configured on the backend, so no build-time SITE_NAME handling is needed.
npm run build
# The standalone server serves public/ and .next/static from its own folder.
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# Bring the frontend back up as soon as the new build is in place, so a broken
# build surfaces now instead of at the very end of the update. It comes back
# before the backend migration below; the backend briefly runs its previous
# build, which only affects live API calls, never the static assets.
echo "==> Starting the frontend"
systemctl start pingvin-front.service 2>/dev/null || true

echo "==> Preparing data directory and backend/.env"
mkdir -p "$DATA_DIR"
ENV_FILE="$SRC_DIR/backend/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
  fi
}
ensure_env() {
  grep -q "^$1=" "$ENV_FILE" || printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
}
# The database location is fixed for this deployment.
set_env DATABASE_URL "\"$DB_URL\""
set_env DATA_DIRECTORY "\"$DATA_DIR\""
# Keep existing custom values; add defaults on first deploy.
ensure_env TRUST_PROXY "true"
ensure_env VISITOR_RATE_LIMIT "90"
ensure_env VISITOR_RATE_TTL_MS "60000"
ensure_env VISITOR_RATE_BLOCK_MS "60000"
# Enable the local Valkey cache when the service is already installed.
if systemctl is-active --quiet valkey-server; then
  ensure_env CACHE_REDIS_ENABLED "true"
  ensure_env CACHE_REDIS_URL "redis://127.0.0.1:6379"
fi

# Stop the old backend first so the SQLite migration cannot race live writes.
systemctl stop pingvin-back.service 2>/dev/null || true
echo "==> Applying database migrations"
cd "$SRC_DIR/backend"
# Prisma CLI loads backend/prisma/.env after backend/.env, which would point
# migrations at the local development database. Pass the production URL
# explicitly; the systemd unit gets it from backend/.env on restart.
DATABASE_URL="$DB_URL" npx prisma migrate deploy

# Rebuild the database file after index/data changes so free pages and
# fragmentation do not accumulate. The backend is stopped, so VACUUM has
# exclusive access; maintain-db.js logs and skips on failure.
echo "==> Compacting SQLite database"
DATABASE_URL="$DB_URL" node scripts/maintain-db.js

echo "==> Installing systemd units"
install -m 644 "$SRC_DIR/pingvin-back.service" /etc/systemd/system/pingvin-back.service
install -m 644 "$SRC_DIR/pingvin-front.service" /etc/systemd/system/pingvin-front.service
systemctl daemon-reload

echo "==> Restarting the backend (runs database migrations)"
systemctl restart pingvin-back.service

echo "==> Waiting for the backend to be ready"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/api/configs >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Ensuring the frontend is running"
# It was started right after its build above; restart only if that failed.
systemctl is-active --quiet pingvin-front.service ||
  systemctl restart pingvin-front.service

echo "==> Update finished"
for unit in pingvin-back.service pingvin-front.service; do
  if systemctl is-active --quiet "$unit"; then
    echo "$unit: active"
  else
    echo "WARNING: $unit is not active - check 'journalctl -u $unit'" >&2
  fi
done
