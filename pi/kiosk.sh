#!/usr/bin/env bash
# Opens the Squawk pilot cockpit full-screen on the Pi.
# Usage: ./kiosk.sh            (reads WEB_URL / PI_SESSION_ID from pi/.env)
#        WEB_URL=http://192.168.1.20:3000 ./kiosk.sh
set -euo pipefail

cd "$(dirname "$0")"
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

WEB_URL="${WEB_URL:?Set WEB_URL (e.g. http://192.168.1.20:3000) in pi/.env}"
WEB_URL="${WEB_URL%/}"
SESSION="${PI_SESSION_ID:-DEMO}"

CHROMIUM="$(command -v chromium-browser || command -v chromium || true)"
if [[ -z "$CHROMIUM" ]]; then
  echo "Chromium not found. Install with: sudo apt install chromium-browser" >&2
  exit 1
fi

# --unsafely-treat-insecure-origin-as-secure lets getUserMedia (the mic) work over plain
# http on the LAN; Chromium only honours it with a dedicated --user-data-dir.
exec "$CHROMIUM" \
  --kiosk \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --unsafely-treat-insecure-origin-as-secure="$WEB_URL" \
  --user-data-dir="$HOME/.config/squawk-kiosk" \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --disable-infobars \
  "$WEB_URL/fly?role=pilot&session=$SESSION"
