# hermes-mobile app

Vite + React + TypeScript PWA. See the [repo README](../README.md) for architecture and deployment.

```bash
npm install
npm run dev      # dev server with /api + /auth proxy (set HERMES_BACKEND in .env.local)
npm run build    # type-check + production build → dist/
npm run smoke    # live-backend smoke test of src/lib/hermes-client.ts
npm run lint     # oxlint
```
