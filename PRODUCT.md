# Product

<!-- impeccable:product-schema 1 -->

## Platform

mobile-first PWA; kandidat shell native iOS/Android belum diputus

## Stack

React 19 + TypeScript + Vite 8. Mockup statis single-file HTML/CSS tetap jadi referensi visual; shell native belum diputus.

## Users

Owner (Iqbal) — power user Hermes yang punya beberapa mesin (T14, NUC `linc-nuc`, HP x360) di satu tailnet. Situasi: jauh dari desktop, mau tetap bisa ngobrol sama agent, delegasi tugas antar-agent, dan approve aksi dari HP.

## Product Purpose

Mobile client untuk Hermes Agent yang berjalan di mesin sendiri, dijangkau lewat Tailnet HTTPS. Target produk: seluruh fitur resmi Hermes Desktop dapat diakses dari HP, termasuk bundled Bot Mode, Kanban, dan Accent. Desain A — Shell dipilih Owner; implementasi browser yang tersedia, aksi yang belum diimplementasikan, dan batas native dibedakan secara eksplisit. Kontrak penerimaan: `docs/production/shell-a-spec.md`.

## Positioning

Bukan chatbot cloud — client tipis ke agent self-hosted: sesi, tool, dan eksekusi terjadi di gateway; HP menampilkan dan mengendalikan fitur melalui kontrak yang didukung. Klaim paritas mengikuti bukti per aksi, bukan jumlah layar.

## Operating Context

- Koneksi browser production: Tailnet HTTPS satu origin untuk app dan `/api`, `/auth`, serta `/v1`; backend proxy internal mengikuti konfigurasi serving yang sudah ada.
- Backend: `hermes serve` / gateway Hermes (`/api/ws` JSON-RPC, Sessions API, bot_relay RPCs).
- Bot Mode: sesi berjudul "Bot Chat", tool `message_agent`, relay daemon headless mengantar envelope antar-gateway; reply datang async sebagai turn baru.
- Multi-device: user memilih device (connection) dulu, sesi scoped per gateway.

## Capabilities and Constraints

- Layar inti: Connections (pilih device) → Chat list → Chat view (streaming, tool cards, approval sheet) → Bots roster → Bot chat (delegasi + reply async).
- Auth: password login + ticket WS; credential masih di `localStorage` browser untuk v1, secure storage backlog.
- Belum diputus: shell native, mode SSH (backlog v2), push notification saat HP di background.

## Brand Commitments

Arah visual dipin user: mengikuti Hermes Desktop (dark, agent/terminal vibe). Token dan tipografi aktual mengikuti `DESIGN.md` dan CSS app. Referensi desain A dibekukan pada commit `46c10ad4c206fd04c5b13ed593deeb1c11e9aecc` di branch `ux/mobile-parity-review`; data prototype tidak digunakan sebagai data production.

## Evidence on Hand

- Repo: `~/.hermes/hermes-agent` (gateway, tui_gateway, apps/desktop).
- Token tema: `apps/desktop/src/styles.css` (`:root.dark`).
- Data demo di mockup bersifat sintetis (nama device user nyata: T14, linc-nuc, x360).

## Product Principles

1. Server adalah sumber kebenaran — HP hanyalah layar; sync gratis karena sesi hidup di gateway.
2. Agent plumbing kelihatan, tidak disembunyikan — tool calls, approval, dan delegasi bot adalah konten utama, bukan disembunyikan.
3. Bot Mode warga kelas satu — delegasi agent-to-agent dapat layar dan flow sendiri, bukan terselip di chat biasa.
4. Multi-device eksplisit — user selalu tahu sedang terhubung ke mesin mana.
