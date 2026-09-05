# hermes-mobile

A mobile-first PWA client for a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent) backend (`hermes serve`), reached over your Tailscale tailnet or LAN.

Hermes Mobile is a screen onto your own machines. Agent execution lives on the gateway; the browser owns navigation, local connection/group metadata and transient drafts. Chat streams live, tool activity stays compact, and command approvals remain explicit.

> Shell A migration candidate: **Home / Chats / Bots / Activity / Manage**, with contextual Workspace tools. This is not a claim of complete Desktop parity or production certification. Secure credential storage, native integrations and physical-device signoff remain open. See the [acceptance contract](docs/production/shell-a-spec.md) and [quality gate](docs/production/quality-gate.md).

## Shell A surfaces

- Existing chat/resume, scoped model selection, attachments, approvals, Bot Chats, Groups and tracked Runs remain accessible. Groups live under Chats; Runs under Activity.
- Manage provides profile/capability inspection, a reviewed profile-description update, bounded memory/schedule/messaging reads and shared Kanban board inspection. [Scope and unsupported operations](docs/production/management-contracts.md) are explicit; this is not a universal configuration editor.
- Workspace provides bounded read-only Files and Git status/diff tied to a conversation's gateway/profile/cwd. External previews require explicit trust review; terminal execution and in-app annotation remain unavailable. See [Workspace boundaries](docs/production/workspace-contracts.md).
- Appearance is local to this browser, not an update to the Desktop Accent plugin or profile defaults.

## Screenshots

The current visual contract lives in [`DESIGN.md`](DESIGN.md). The approved [Shell A reference](https://github.com/labsiqbal/hermes-mobile/blob/ux/mobile-parity-review/design/parity-shell/index.html) is an explicitly simulated design artifact, not the application. [`design/index.html`](design/index.html) is historical.

## Requirements

- An authenticated Hermes gateway reachable by the same-origin proxy, with a basic username/password provider. Management/Workspace contracts are pinned in their linked documents; an exhaustive compatibility-certified minimum gateway version has not been established. Unsupported routes fail visibly.
- Reachability from your phone: a **Tailscale tailnet** (recommended) or plain LAN.
- A Node version supported by `app/package.json` and the locked Vite dependencies, plus npm. Use the same Node major as the repository CI for reproducible builds.

## Architecture

```
phone browser ──HTTPS (tailscale serve)──► one origin on the tailnet
                                            ├── /          → static PWA (this repo, app/dist)
                                            ├── /api,/auth → configured Hermes gateway
                                            │                └── WS /api/ws?ticket=… (newline-delimited JSON-RPC)
                                            └── /v1        → configured tracked-runs service, when available
```

- **Auth:** password login (`POST /auth/password-login`, provider `basic`) → session cookie → `POST /api/auth/ws-ticket` for a single-use 30s ticket → `ws://…/api/ws?ticket=…`.
- **Wire protocol:** newline-delimited JSON-RPC 2.0. Methods used: `session.list`, `session.create`, `session.resume`, `prompt.submit`, `approval.respond`. Server pushes `event` frames (`gateway.ready`, `message.start/delta/complete`, `tool.start/complete`, `approval.request`, …).
- **Client core:** [`app/src/lib/hermes-client.ts`](app/src/lib/hermes-client.ts) is a pure, React-free module (connection registry, auth, ticket, reconnecting WS JSON-RPC, session CRUD, streaming subscriptions) — reusable as-is from a future Flutter/native shell.

## Quickstart — development

```bash
cd app
npm ci --include=dev
# point the dev proxy at your gateway:
HERMES_BACKEND=http://nuc.tailcf7779.ts.net:9119 npm run dev -- --host 127.0.0.1
```

Open the printed `localhost` URL. This example explicitly binds development to loopback. The Vite dev server proxies `/api` + `/auth` (including the WebSocket upgrade) to the backend, so dev is same-origin. Use the existing Tailnet HTTPS app for phone access; a new LAN listener or proxy route is a separate deployment decision.

The optional live smoke test authenticates, creates a real session and sends a real prompt, which may incur provider cost. It reads local gateway credentials and is not part of the offline/CI release gate. Run it only with explicit operator approval:

```bash
npm run smoke   # explicit operator approval required: reads local auth and sends a real prompt
```

## Updating an existing deployment

Use the reviewed static publication procedure in [`docs/production/static-publication.md`](docs/production/static-publication.md). Build and test in an isolated output directory; do not run Vite against a currently served `app/dist`, because its cleanup can remove assets still needed by open clients. Commit/push alone does not update an existing Tailscale filesystem mount.

## First-time deployment (operator setup)

The following route/configuration setup is for a new installation, not an existing-site update. Changing gateway configuration, restarting a service or exposing a listener requires the operator’s explicit approval.

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
cd ..
sudo ./deploy/serve.sh "$PWD/app/dist" <your-node>.<tailnet>.ts.net:9119 8451
# which runs:
#   tailscale serve --bg --https=8451 --set-path /     dist
#   tailscale serve --bg --https=8451 --set-path /api  http://<your-node>.<tailnet>.ts.net:9119/api
#   tailscale serve --bg --https=8451 --set-path /auth http://<your-node>.<tailnet>.ts.net:9119/auth
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

- Connection credentials are stored in plaintext `localStorage` in the browser profile. A private tailnet does **not** protect that storage from XSS, browser extensions, or another person using the same browser profile. Use only a trusted private browser/device; secure credential handling remains a production-hardening gap (see PRODUCT.md).
- Agent/API traffic targets configured gateways. Separately, explicit external-preview actions can open a user-reviewed URL in an isolated tab; normal browser cookie rules still apply.

## License

MIT — see [LICENSE](LICENSE). Hermes Agent itself is upstream at NousResearch/hermes-agent; this repo is an independent client and does not vendor or modify upstream code.
