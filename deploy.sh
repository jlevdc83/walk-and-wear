#!/usr/bin/env bash
# Deploy Walk & Wear to the Pi.
#
# The only way changes should reach /opt/walk-and-wear. This repo owns the app;
# pi-services owns walk-and-wear.service and the tailscale serve front — the same
# split as doc-review/docs-hub. If you change the unit or the HTTPS mount, that
# change belongs in pi-services and is applied by its deploy.sh, not this one.
#
# Never touches secrets. The app reads HOOBS through /etc/hoobs-mcp.env, which is
# root-owned on the Pi and rides the encrypted nightly backup.
set -euo pipefail

PI="${PI_HOST:-pi}"
DEST="/opt/walk-and-wear"
cd "$(dirname "$0")"

# session-export holds the Pi's tailnet address, LAN subnet, MAC addresses and the
# HOOBS accessory layout, and must never reach the Pi. The rest are working files or
# dev tooling, not runtime — the app itself has no dependencies.
#
# --delete-excluded, not plain --delete: an excluded path is otherwise *protected*
# from deletion, so anything that reached /opt before it was excluded stays there
# forever. That is how design/ and a stray node_modules/ ended up on the Pi.
echo "==> syncing app to $PI:$DEST"
rsync -a --delete --delete-excluded \
  --exclude '.git' \
  --exclude 'session-export' \
  --exclude 'previews' \
  --exclude 'design' \
  --exclude 'node_modules' \
  --exclude 'package-lock.json' \
  --exclude 'BACKLOG.md' \
  --exclude 'deploy.sh' \
  -e ssh ./ "$PI:$DEST/"

# serve.py is read once at process start, so a change to it needs the restart.
# Static files are read per request and do not — but restarting is cheap here and
# guarantees the running server matches what was just synced.
echo "==> restarting walk-and-wear"
ssh "$PI" 'sudo -n systemctl restart walk-and-wear
  sleep 1
  printf "  walk-and-wear  %s\n" "$(systemctl is-active walk-and-wear)"'

echo "==> verifying"
ssh "$PI" 'set -e
  v=$(grep -m1 "const VERSION" '"$DEST"'/js/app.js | sed "s/.*\"\(v[0-9]*\)\".*/\1/")
  printf "  deployed       %s\n" "$v"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 https://pi.tail1d9da7.ts.net/walk/)
  printf "  https /walk    %s\n" "$code"
  [ "$code" = "200" ] || { echo "  !! HTTPS front not answering — check: tailscale serve status"; exit 1; }'

echo "==> done"
