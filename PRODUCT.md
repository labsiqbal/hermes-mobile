# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (mockup); target akhir: mobile app (iOS/Android), stack belum diputus

## Stack

delegated: mockup statis single-file HTML/CSS untuk review visual; stack app beneran belum diputus (kandidat: Flutter / React Native / native)

## Users

Owner (Iqbal) — power user Hermes yang punya beberapa mesin (T14, NUC `linc-nuc`, HP x360) di satu tailnet. Situasi: jauh dari desktop, mau tetap bisa ngobrol sama agent, delegasi tugas antar-agent, dan approve aksi dari HP.

## Product Purpose

Mobile client untuk Hermes-Agent yang jalan di mesin sendiri, dijangkau lewat Tailscale. Bikin agent (dan jaringan bot-nya) bisa dipakai dari HP dengan sesi yang tersync dengan Desktop.

## Positioning

Bukan chatbot cloud — client tipis ke agent self-hosted: semua sesi, tool, dan eksekusi terjadi di mesin user; HP cuma layar. Satu-satunya mobile client dengan Bot Mode (agent-to-agent delegation) Hermes.

## Operating Context

- Koneksi: Tailscale tailnet (CGNAT 100.64.0.0/10), plain HTTP di dalam tailnet.
- Backend: `hermes serve` / gateway Hermes (`/api/ws` JSON-RPC, Sessions API, bot_relay RPCs).
- Bot Mode: sesi berjudul "Bot Chat", tool `message_agent`, relay daemon headless mengantar envelope antar-gateway; reply datang async sebagai turn baru.
- Multi-device: user memilih device (connection) dulu, sesi scoped per gateway.

## Capabilities and Constraints

- Layar inti: Connections (pilih device) → Chat list → Chat view (streaming, tool cards, approval sheet) → Bots roster → Bot chat (delegasi + reply async).
- Auth: token/ticket WS; credential di secure storage HP.
- Belum diputus: stack app, mode SSH (backlog v2), push notification saat HP di background.

## Brand Commitments

Arah visual dipin user: mengikuti Hermes Desktop (dark, agent/terminal vibe). Token asli: chrome `#0d0d0e`, sidebar `#0a0a0b`, card `#161618`, primary `#0053fd`, warm `#cf806d`, selection amber `#ffd24a`; font display "Collapse", mono "JetBrains Mono".

## Evidence on Hand

- Repo: `~/.hermes/hermes-agent` (gateway, tui_gateway, apps/desktop).
- Token tema: `apps/desktop/src/styles.css` (`:root.dark`).
- Data demo di mockup bersifat sintetis (nama device user nyata: T14, linc-nuc, x360).

## Product Principles

1. Server adalah sumber kebenaran — HP hanyalah layar; sync gratis karena sesi hidup di gateway.
2. Agent plumbing kelihatan, tidak disembunyikan — tool calls, approval, dan delegasi bot adalah konten utama, bukan disembunyikan.
3. Bot Mode warga kelas satu — delegasi agent-to-agent dapat layar dan flow sendiri, bukan terselip di chat biasa.
4. Multi-device eksplisit — user selalu tahu sedang terhubung ke mesin mana.
