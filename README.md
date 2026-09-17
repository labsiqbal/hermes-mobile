# hermes-mobile

**Unofficial** phone app for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Chat with **your** self-hosted gateway from a browser, then Add to Home Screen.

> Independently developed; not affiliated with or endorsed by Nous Research. Not an official Hermes app. There is no public hosted demo.

The gateway runs the agent (`hermes serve`). This repo is the PWA client. Reach it over a **Tailscale tailnet** (recommended) or LAN.

## Install

You need an authenticated Hermes gateway with basic username/password, reachable from the phone.

```bash
cd app
npm ci --include=dev
npm run build
```

Serve `app/dist` **on the same origin** as the gateway (Hermes only allows localhost CORS). On a tailnet:

```bash
# set dashboard.public_url on the gateway to this HTTPS origin, then:
sudo ./deploy/serve.sh "$PWD/app/dist" <your-node>.<tailnet>.ts.net:9119 8451
```

Open that URL on the phone and Add to Home Screen. Any reverse proxy that can mount `/`, `/api`, and `/auth` on one origin also works. Recipe: [`deploy/serve.sh`](deploy/serve.sh).

Local loopback only:

```bash
cd app
HERMES_BACKEND=http://your-gateway-host:9119 npm run dev -- --host 127.0.0.1
```

## Add a device

1. Open the PWA.
2. Tap **Add device**.
3. Enter a label, the gateway URL (`https://node.tailnet.ts.net:8451` or a LAN URL), username, and password.
4. Save, then tap the device to connect.

Use a trusted private phone. Credentials stay in this browser's `localStorage`.

## Tabs

Current app: **Chats / Bots / Cronjobs / Manage**. Screenshots are the built React app with **fictional demo data** (labeled "QA ..." / "Connected" in the simulation). No real credentials or private chats.

| Chats | Bots |
| --- | --- |
| [<img src="screenshots/chats.png" width="260" alt="Hermes Mobile Chats: project folders and recent conversations with a four-tab bar">](screenshots/chats.png) | [<img src="screenshots/bots.png" width="260" alt="Hermes Mobile Bots: roster of bot identities with Bots and Groups switch">](screenshots/bots.png) |
| Resume sessions from a folder tree. New chat starts in the device default folder. | Talk to bot profiles, open private threads, or switch to Groups. |

| Cronjobs | Manage |
| --- | --- |
| [<img src="screenshots/cronjobs.png" width="260" alt="Hermes Mobile Cronjobs: read-only scheduled jobs and a Runs button">](screenshots/cronjobs.png) | [<img src="screenshots/manage.png" width="260" alt="Hermes Mobile Manage hub: settings, profiles, memory, and capabilities">](screenshots/manage.png) |
| Read-only schedules. **Runs** is a separate execution journal. | Inspect profiles, appearance, skills, memory, messaging, Kanban. Not a Desktop settings editor. |

Open a chat to compose, attach files, pick a model, and stream a reply.

## Limitations

Unofficial and self-hosted only. Not Hermes Desktop parity and not a hosted SaaS. Missing gateway routes fail visibly. Optional dictation uses the browser speech API. Secure credential storage is not implemented.

MIT - see [LICENSE](LICENSE). Hermes Agent is upstream at NousResearch/hermes-agent.
