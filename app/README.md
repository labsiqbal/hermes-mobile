# hermes-mobile app

Vite + React + TypeScript PWA. See the [repo README](../README.md) for install and adding a device.

```bash
npm install
npm run dev      # dev server with /api + /auth proxy (set HERMES_BACKEND in .env.local)
npm run build    # type-check + production build → dist/
npm run smoke    # live gateway: authenticates, creates a session and sends a prompt;
                 # requires explicit operator approval and may incur provider cost
npm run lint     # oxlint
```
