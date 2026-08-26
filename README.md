# hermes-mobile

A mobile-first PWA client for a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent) backend (`hermes serve`), reached over your Tailscale tailnet or LAN.

Hermes Mobile is a thin screen onto your own machines: every session, tool call, and approval happens on the gateway — the phone is just a window. Chat sessions stream live, tool calls render as first-class cards, and dangerous-command approvals pop up as a bottom sheet you can approve or deny from anywhere on the tailnet.

> Early v1. Chat, approvals, Bots, Rooms, Groups, Runs, and the headless relay work. Secure credential storage, push notifications, and voice input remain backlog. See `PRODUCT.md` and `DESIGN.md` for product truth and design system.

## Screenshots

UI is pinned to the approved mockup in [`design/index.html`](design/index.html) — open it in a browser for the six reference screens (Connections, Chats, Chat + approval sheet, Bots roster, Delegation, Bot Chat).

## Requirements

- A machine running **Hermes ≥ 0.20.x** with `hermes serve` bound to a non-loopback interface (auth gate active — a `dashboard.basic_auth` username/password provider configured).
- Reachability from your phone: a **Tailscale tailnet** (recommended) or plain LAN.
- Node ≥ 20 + npm, for development and building the app.

## Architecture

```
phone browser ──HTTPS (tailscale serve)──► one origin on the tailnet
                                            ├── /          → static PWA (this repo, app/dist)
                                            └── /api,/auth → hermes serve (127.0.0.1:9119)
                                                     └── WS /api/ws?ticket=… (newline-delimited JSON-RPC)
```

- **Auth:** password login (`POST /auth/password-login`, provider `basic`) → session cookie → `POST /api/auth/ws-ticket` for a single-use 30s ticket → `ws://…/api/ws?ticket=…`.
- **Wire protocol:** newline-delimited JSON-RPC 2.0. Methods used: `session.list`, `session.create`, `session.resume`, `prompt.submit`, `approval.respond`. Server pushes `event` frames (`gateway.ready`, `message.start/delta/complete`, `tool.start/complete`, `approval.request`, …).
- **Client core:** [`app/src/lib/hermes-client.ts`](app/src/lib/hermes-client.ts) is a pure, React-free module (connection registry, auth, ticket, reconnecting WS JSON-RPC, session CRUD, streaming subscriptions) — reusable as-is from a future Flutter/native shell.

## Quickstart — development

```bash
cd app
npm install
# point the dev proxy at your gateway:
echo 'HERMES_BACKEND=http://100.105.150.35:9119' > .env.local   # edit to your machine
npm run dev
```

Open the printed `localhost` URL (or the LAN URL on your phone). The Vite dev server proxies `/api` + `/auth` (including the WebSocket upgrade) to the backend, so dev is same-origin and no CORS config is needed.

To verify the client library end-to-end against a live backend without the UI (auth → WS → `session.list` → `session.create` → `prompt.submit` → streamed turn):

```bash
npm run smoke   # reads dashboard.basic_auth.secret from ~/.hermes/config.yaml, never prints it
```

## Quickstart — deploy (tailscale serve)

**Why same-origin?** `hermes serve` hardcodes CORS to localhost origins (`hermes_cli/web_server.py`, `allow_origin_regex` covers only `localhost`/`127.0.0.1`) and validates the HTTP `Host` header and WebSocket `Origin` header against the bound interface plus the hostnames declared in `dashboard.public_url`. There is **no config knob to allow additional CORS origins**. A PWA served from a different origin cannot even read `GET /api/status` responses, and its WS handshake is rejected (verified by probing: foreign `Origin` → no `Access-Control-Allow-Origin`; foreign `Host` → 400; WS with foreign `Origin` → 403 even with a valid ticket). So the app must be served **same-origin with the API** — one small reverse proxy in front of both.

The fewest moving parts on a tailnet is `tailscale serve` alone — it can serve the static build AND proxy the API on one HTTPS endpoint:

```bash
# 1. build the app
cd app && npm install && npm run build   # outputs app/dist

# 2. tell Hermes its browser-facing URL so the Host/Origin guard accepts it.
#    config.yaml (or env HERMES_DASHBOARD_PUBLIC_URL), then restart hermes serve:
#    dashboard:
#      public_url: "https://<your-node>.<tailnet>.ts.net:8451"

# 3. one tailnet HTTPS endpoint (see deploy/serve.sh):
sudo ./deploy/serve.sh dist <tailscale-ip>:9119 8451
# which runs:
#   tailscale serve --bg --https=8451 --set-path /     dist
#   tailscale serve --bg --https=8451 --set-path /api  http://<tailscale-ip>:9119/api
#   tailscale serve --bg --https=8451 --set-path /auth http://<tailscale-ip>:9119/auth
```

Two gotchas that recipe works around (both verified against a live backend):

- **`tailscale serve` strips the mount prefix before proxying.** A target of `http://host:9119` for mount `/api` would forward `/api/status` as `/status` (404/405 on the backend). Carrying the prefix in the target URL (`http://host:9119/api`) puts it back. Static path mounts are not affected.
- **Proxy to the address Hermes actually binds**, not `127.0.0.1`, if `hermes serve --host` is a tailnet IP — otherwise the proxy gets connection-refused (502).

Then open `https://<your-node>.<tailnet>.ts.net:8451` on the phone and "Add to Home Screen".

Notes:

- `tailscale serve` forwards the original `Host` header; without step 2 Hermes rejects it with 400/403. `public_url` is the upstream-sanctioned knob — no Hermes code is modified.
- Any reverse proxy that can mount two backends under one origin (nginx, traefik, …) works equally well; `tailscale serve` is just the zero-config TLS option. (Caddy note: its `handle` blocks strip prefixes too — use `handle_path`/targets carefully if you go that route.)

## Bot Mode without a Desktop

Bot Mode (agent-to-agent delegation across gateways) normally relies on the Hermes Desktop plugin relay. This repo ships [`relay-daemon/`](relay-daemon/) — an optional headless companion (Python, systemd unit included) that runs the roster-sync + envelope-drain loops 24/7 so bot replies keep flowing while no Desktop is open. See [`relay-daemon/README.md`](relay-daemon/README.md).

## Security notes (v1)

- Connection credentials are stored in `localStorage` in the browser profile. That is acceptable only because the app is meant to be reached over your private tailnet; encrypted secure storage is backlog (see PRODUCT.md).
- The app never talks to anything but the gateway URLs you configure.

## License

MIT — see [LICENSE](LICENSE). Hermes Agent itself is upstream at NousResearch/hermes-agent; this repo is an independent client and does not vendor or modify upstream code.
