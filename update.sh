#!/usr/bin/env bash
#
# Rafidain Market — production update script
# Usage (on the VPS, as root or with sudo):
#   bash update.sh
# Performs: code update (git pull if a repo, else re-upload + rerun),
# dependency install, DB migrations, frontend rebuild, and service reload.
#
set -euo pipefail

# ---- Anchor to the project directory ----
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"
echo "==> Updating Rafidain Market in: $BASE"

# ---- 1) Update source code ----
if [ -d "$BASE/.git" ]; then
  echo "==> Pulling latest code (git)..."
  git pull --ff-only || echo "WARNING: git pull failed; continuing with current files."
else
  echo "NOTE: not a git repository. To update, re-upload the new package over this"
  echo "      folder, then re-run this script — it will re-install, migrate, rebuild,"
  echo "      and reload using the new files."
fi

# ---- 2) Server dependencies + migrations ----
echo "==> Updating server dependencies + running migrations..."
cd "$BASE/server"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run migrate
cd "$BASE"

# ---- 3) Rebuild the four frontends and republish dist ----
APPS=(customer-mobile admin-panel agent-panel provider-panel)
for app in "${APPS[@]}"; do
  echo "==> Rebuilding $app..."
  ( cd "$BASE/$app" && npm install && npm run build )
  echo "==> Publishing $app/dist to its web root..."
  mkdir -p "$BASE/$app"
  cp -r "$BASE/$app/dist/." "$BASE/$app/"
done

# ---- 4) Reload API (PM2) ----
echo "==> Reloading API (PM2)..."
if pm2 reload rafidain-server 2>/dev/null; then
  :
elif pm2 restart rafidain-server 2>/dev/null; then
  :
else
  echo "    (re)starting via ecosystem..."
  pm2 start "$BASE/deploy/ecosystem.config.js" --env production
fi
pm2 save

# ---- 5) Reload nginx ----
echo "==> Reloading nginx..."
if nginx -t 2>/dev/null; then
  systemctl reload nginx || service nginx reload || true
  echo "    nginx reloaded."
else
  echo "WARNING: nginx -t failed. Please review /etc/nginx and reload manually."
fi

# ---- 6) Done ----
echo
echo "=========================================================="
echo " Rafidain Market update complete"
echo " Health check: curl -s http://localhost:4001/api/health"
echo "=========================================================="
