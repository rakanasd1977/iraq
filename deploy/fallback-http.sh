#!/usr/bin/env bash
# Generates an HTTP-only nginx site config (no TLS) used as a fallback when
# Let's Encrypt/certbot is unavailable or fails, so the site still comes up.
# Usage: fallback-http.sh <domain> <base>
set -euo pipefail
DOMAIN="${1:-rafidain.example}"
BASE="${2:-/var/www/rafidain}"

block() {
  local server_name="$1"; local root="$2"
  cat <<EOF
server {
    listen 80;
    server_name $server_name;
    root $root;
    index index.html;
    include /etc/nginx/rafidain/headers.conf;
    include /etc/nginx/rafidain/static.conf;
    include /etc/nginx/rafidain/api.conf;
}

EOF
}

block "$DOMAIN www.$DOMAIN" "$BASE/customer-mobile"
block "agent.$DOMAIN"       "$BASE/agent-panel"
block "admin.$DOMAIN"       "$BASE/admin-panel"
block "provider.$DOMAIN"    "$BASE/provider-panel"
