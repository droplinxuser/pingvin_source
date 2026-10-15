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

[ "$(id -u)" -eq 0 ] || { echo "Error: run as root" >&2; exit 1; }

echo "==> Pulling latest code"
git checkout main
# The frontend build rewrites public/manifest.json with the configured site
# name; restore it first so the pull below can never conflict.
git checkout -- frontend/public/manifest.json 2>/dev/null || true
git pull --ff-only

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
npm ci --no-audit --no-fund
# Export the site name from the backend systemd unit (where it is configured)
# so the frontend build can use it for the PWA manifest.
if [ -z "${SITE_NAME:-}" ]; then
  SITE_NAME="$(sed -n 's/^Environment=SITE_NAME="\?\([^"]*\)"\?$/\1/p' /etc/systemd/system/pingvin-back.service 2>/dev/null | tail -n1 || true)"
  [ -n "$SITE_NAME" ] && export SITE_NAME
fi
npm run build
# The standalone server serves public/ and .next/static from its own folder.
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
git checkout -- public/manifest.json # keep the working tree clean

echo "==> Preparing data directory and backend/.env"
mkdir -p "$DATA_DIR"
if [ ! -f "$SRC_DIR/backend/.env" ]; then
  cat > "$SRC_DIR/backend/.env" <<EOF
DATABASE_URL="file:$DATA_DIR/pingvin-share.db?connection_limit=1"
DATA_DIRECTORY="$DATA_DIR"
EOF
  echo "Created backend/.env"
fi

echo "==> Restarting the backend (runs database migrations)"
systemctl restart pingvin-back.service

echo "==> Waiting for the backend to be ready"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/api/configs >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Restarting the frontend"
systemctl restart pingvin-front.service

echo "==> Update finished"
for unit in pingvin-back.service pingvin-front.service; do
  if systemctl is-active --quiet "$unit"; then
    echo "$unit: active"
  else
    echo "WARNING: $unit is not active - check 'journalctl -u $unit'" >&2
  fi
done
