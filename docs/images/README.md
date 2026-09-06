# App screenshots

Actual app UI shown with demo data.

These images show Hermes Mobile built from commit [`055a5968f5c23f2c8659da47a288e9475cc1db5e`](https://github.com/labsiqbal/hermes-mobile/commit/055a5968f5c23f2c8659da47a288e9475cc1db5e), at a 390 × 844 mobile viewport and 100% Standard UI scale.

- [`chat.png`](chat.png): a fictional reading-plan conversation and an unsent composer draft.
- [`chats.png`](chats.png): project/profile filters, a fictional Reading notes project, and recent chats.
- [`appearance.png`](appearance.png): device-local UI scale and scratch accent settings.

## Capture method

The app was built with `npm run build`. The existing [production browser harness](../production/browser-testing.md) served that build on an isolated loopback origin in a disposable Chrome profile. Its fictional transport fixtures supplied the reading-plan text, project labels and session history before the production bundle loaded. Navigation and draft entry used the app's actual controls.

The screenshots are browser captures, not generated mockups. PNG compression is lossless; no UI content was retouched, replaced or composited. The capture passed its three viewport layout checks with no browser diagnostics, unexpected network requests or fixture violations. The browser exited, its temporary profile was removed and the loopback server closed.

## What they do not prove

The gateway label, model, conversations and connection status are demo data. “Connected” does not indicate a real authenticated gateway session. No live gateway was contacted, no prompt was sent and no production operation was performed. These images do not establish full Desktop parity, provider compatibility, physical-device behavior or production certification.

For future captures, rebuild the intended source in a separate output directory, reuse the fixture harness with fictional data, and review every image for privacy and legibility. Do not use a private browser profile or publish real gateway addresses, credentials or conversations.
