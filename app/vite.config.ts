import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev backend: the `hermes serve` base URL on your tailnet/LAN. Override with
// HERMES_BACKEND in app/.env.local (gitignored). The dev server proxies /api
// and /auth so development stays same-origin — Hermes hardcodes CORS to
// localhost and rejects foreign Host/WS-Origin headers, so direct
// cross-origin calls from the browser would fail.
const backend = process.env.HERMES_BACKEND ?? "http://127.0.0.1:9119";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true, // Host header must match the bound interface
        ws: true,
      },
      "/auth": {
        target: backend,
        changeOrigin: true,
      },
    },
  },
});
