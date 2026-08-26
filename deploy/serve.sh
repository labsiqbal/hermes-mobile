#!/usr/bin/env bash
# Expose the hermes-mobile PWA + Hermes API on one tailnet origin.
#
# Why this shape: the Hermes server hardcodes CORS to localhost and guards
# Host/Origin headers, so the PWA must be same-origin with the API.
# `tailscale serve` path mounts STRIP the mount prefix before proxying, so
# each proxy target carries its prefix in the URL to put it back
# (`/api/x` -> strip `/api` -> prepend target path `/api` -> `/api/x`).
#
# Prereq: ~/.hermes/config.yaml → dashboard.public_url must match the public
# origin below (host part), then restart the Hermes dashboard/serve service.
#
# Usage: sudo ./deploy/serve.sh <dist-dir> <backend-host:port> [https-port]
set -euo pipefail

DIST=${1:?dist dir, e.g. app/dist}
BACKEND=${2:?backend host:port, e.g. 100.105.150.35:9119}
PORT=${3:-8451}

tailscale serve --bg --https="$PORT" --set-path / "$DIST"
tailscale serve --bg --https="$PORT" --set-path /api "http://$BACKEND/api"
tailscale serve --bg --https="$PORT" --set-path /auth "http://$BACKEND/auth"

tailscale serve status
echo "Open: https://$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):$PORT/"
