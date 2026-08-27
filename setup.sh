#!/usr/bin/env bash
#
# Rafidain Market — automated production setup
# Usage (on the VPS, as root or with sudo):
#   bash setup.sh [domain] [email]
# Example:
#   bash setup.sh rafidain.example admin@rafidain.example
# If arguments are omitted you will be prompted.
#
set -euo pipefail

# ---- Anchor to the extracted project directory ----
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"
echo "==> Working in: $BASE"

# ---- 1) Node version check (>= 22.5) ----
NODE_VER="$(node -v | sed 's/^v//')"
if ! node -e "const v=process.versions.node.split('.').map(Number); process.exit((v[0]===22&&v[1]>=5)||v[0]>22?0:1)"; then
  echo "ERROR: Node.js >= 22.5 is required (found v$NODE_VER). Install Node 22+ and retry." >&2
  exit 1
fi
echo "==> Node v$NODE_VER OK"

# ---- 2) Domain / email ----
DOMAIN="${1:-}"
EMAIL="${2:-}"
if [ -z "$DOMAIN" ]; then read -r -p "Enter your main domain (e.g. rafidain.example): " DOMAIN; fi
if [ -z "$EMAIL" ]; then read -r -p "Enter an email for TLS certificates (Let's Encrypt): " EMAIL; fi
if [ -z "$DOMAIN" ]; then echo "ERROR: domain is required." >&2; exit 1; fi
echo "==> Domain: $DOMAIN"

# ---- 3) Server dependencies + environment ----
echo "==> Installing server dependencies..."
cd "$BASE/server"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example and generating secrets..."
  cp .env.example .env
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  TOTP_ENC_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=$JWT_SECRET#" .env
  sed -i "s#^TOTP_ENC_KEY=.*#TOTP_ENC_KEY=$TOTP_ENC_KEY#" .env
  sed -i "s#^NODE_ENV=.*#NODE_ENV=production#" .env
  sed -i "s#^PORT=.*#PORT=4001#" .env
  sed -i "s#^DB_PATH=.*#DB_PATH=$BASE/server/data/app.db#" .env
  sed -i "s#^CORS_ORIGINS=.*#CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,https://agent.$DOMAIN,https://admin.$DOMAIN,https://provider.$DOMAIN#" .env
  sed -i "s#^SEED_ALLOW=.*#SEED_ALLOW=1#" .env
  echo "    IMPORTANT: .env was auto-generated with random secrets. Back it up and keep it safe."
  echo "    SEED_ALLOW=1 seeds demo data on first boot; set it to 0 after initial setup if desired."
else
  echo "==> .env already exists — leaving it untouched."
fi

# ---- 4) Database migrations (+ optional seed) ----
echo "==> Running database migrations..."
npm run migrate
if grep -q "^SEED_ALLOW=1" .env; then
  echo "==> Seeding demo data (SEED_ALLOW=1)..."
  npm run seed || echo "    (seed skipped/failed — non-fatal)"
fi
cd "$BASE"

# ---- 5) Build the four frontends and publish dist to their web roots ----
APPS=(customer-mobile admin-panel agent-panel provider-panel)
for app in "${APPS[@]}"; do
  echo "==> Installing + building $app..."
  ( cd "$BASE/$app" && npm install && npm run build )
  echo "==> Publishing $app/dist to its web root..."
  mkdir -p "$BASE/$app"
  cp -r "$BASE/$app/dist/." "$BASE/$app/"
done

# ---- 6) Start API with PM2 ----
echo "==> Installing PM2 (global) if missing..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
echo "==> Starting API via PM2..."
pm2 start "$BASE/deploy/ecosystem.config.js" --env production
pm2 save
echo "    (Optional) enable boot-time restart: sudo pm2 startup"

# ---- 7) nginx + TLS ----
NGX_AVAIL=/etc/nginx/sites-available/rafidain
NGX_ENABL=/etc/nginx/sites-enabled/rafidain
NGX_CONF_DIR=/etc/nginx/rafidain
mkdir -p "$NGX_CONF_DIR" "$NGX_AVAIL" "$NGX_ENABL"

echo "==> Installing nginx configs..."
cp "$BASE/deploy/nginx.headers.conf" "$NGX_CONF_DIR/"
cp "$BASE/deploy/nginx.static.conf"  "$NGX_CONF_DIR/"
cp "$BASE/deploy/nginx.api.conf"     "$NGX_CONF_DIR/"

# Template the site config: replace domain and web-root base path.
sed -e "s|rafidain.example|$DOMAIN|g" -e "s|/var/www/rafidain|$BASE|g" \
    "$BASE/deploy/nginx.conf.example" > "$NGX_AVAIL"

ln -sf "$NGX_AVAIL" "$NGX_ENABL"

# Try to obtain TLS certificates; fall back to HTTP-only if certbot unavailable/fails.
if command -v certbot >/dev/null 2>&1; then
  echo "==> Requesting Let's Encrypt certificates..."
  if certbot --nginx --non-interactive --agree-tos -m "$EMAIL" \
       -d "$DOMAIN" -d "www.$DOMAIN" -d "agent.$DOMAIN" -d "admin.$DOMAIN" -d "provider.$DOMAIN"; then
    echo "==> TLS configured."
  else
    echo "WARNING: certbot failed. Falling back to HTTP-only config."
    "$BASE/deploy/fallback-http.sh" "$DOMAIN" "$BASE" > "$NGX_AVAIL"
    ln -sf "$NGX_AVAIL" "$NGX_ENABL"
  fi
else
  echo "WARNING: certbot not installed. Writing HTTP-only fallback config."
  echo "         Install certbot and run: sudo certbot --nginx -d $DOMAIN ..."
  "$BASE/deploy/fallback-http.sh" "$DOMAIN" "$BASE" > "$NGX_AVAIL"
  ln -sf "$NGX_AVAIL" "$NGX_ENABL"
fi

# ---- 8) Test and reload nginx ----
if nginx -t 2>/dev/null; then
  systemctl reload nginx || service nginx reload || true
  echo "==> nginx reloaded."
else
  echo "WARNING: nginx -t failed. Please review /etc/nginx and reload manually."
fi

# ---- 9) Done ----
echo
echo "=========================================================="
echo " Rafidain Market setup complete"
echo "----------------------------------------------------------"
echo " Health check:  curl -s http://localhost:4001/api/health"
echo " Customer:      http://$DOMAIN  (https after TLS)"
echo " Agent:         http://agent.$DOMAIN"
echo " Admin:         http://admin.$DOMAIN"
echo " Provider:      http://provider.$DOMAIN"
echo "=========================================================="
