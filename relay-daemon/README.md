# hermes-relay-daemon

Daemon headless (Python, single-file) yang menggantikan peran orkestrasi
**Bot Mode relay** yang sebelumnya hanya ada di plugin Electron Hermes Desktop
(`apps/desktop/src/plugins/hermes-bots/plugin.js`, blok `startBotRelay`).
Tujuannya: agent-to-agent messaging antar Hermes gateway (`message_agent`
lintas koneksi) tetap jalan 24/7 tanpa Desktop app — syarat untuk mobile app.

## Apa yang dilakukan

Per koneksi di `config.yaml`, daemon memegang satu WebSocket JSON-RPC ke
`ws://<host>/api/ws` dan menjalankan dua loop:

1. **Roster loop (60s)** — fetch `profiles.list` per koneksi, bentuk union
   roster agen dari koneksi LAIN, push via `bot_relay.roster.sync`. Fetch yang
   gagal memakai cache last-good (fail-soft). Skip kalau koneksi live < 2.
2. **Drain loop** — subscribe event push `bot_relay.outbox.pending`
   (debounce 250ms) + poll backstop 30s. Per koneksi: `bot_relay.outbox.drain`
   → per envelope `bot_relay.deliver` ke socket koneksi target → sukses:
   `bot_relay.reply {id, reply}`; gagal: `bot_relay.reply {id, error, reason}`
   (reason typed dari `error.data` diteruskan); target offline: langsung reply
   error dengan reason `runtime_offline`.

Aman coexist dengan Desktop app yang sedang running: drain gateway-side
bersifat atomic (rename file), jadi siapa pun yang meng-claim lebih dulu yang
menang; tidak ada double-delivery.

## Auth

Daemon membaca kredensial dari `$HERMES_HOME/config.yaml` section
`dashboard.basic_auth` — tidak ada secret baru:

- kalau `secret` ada → daemon me-mint bearer token HMAC sendiri (format sama
  dengan yang di-mint plugin `dashboard_auth/basic`) lalu `POST
  /api/auth/ws-ticket`;
- kalau hanya ada `password` plaintext → `POST /auth/password-login`
  (provider `basic`) lalu mint ticket.

Ticket WS single-use TTL 30s di-mint ulang pada setiap reconnect. Reconnect
memakai exponential backoff (1s → 60s) dan langsung memicu drain setelah
socket up. Nilai secret tidak pernah di-log.

## Menambah koneksi

Edit `config.yaml`, tambah entry (contoh `t14` sudah ada, dikomentari), lalu:

```
systemctl --user restart hermes-relay
```

Syarat sisi target: `hermes serve`/dashboard berjalan di URL itu, auth
`dashboard.basic_auth` dengan username/secret yang sama.

## Operasional

```
systemctl --user status hermes-relay
journalctl --user -u hermes-relay -f          # log live
journalctl --user -u hermes-relay --since today
```

Log ke stdout → journald. Yang dicari saat sehat: `connected to ...` per
koneksi; saat ada trafik: `drained N envelope(s)`, `delivered, reply posted`,
atau `offline — error reply`.

## Limitasi / catatan

- **Namespace connection-id bentrok dengan Desktop.** Desktop memakai id
  koneksinya sendiri (mis. `local`); daemon memakai `name` dari config.yaml.
  Kalau keduanya aktif dengan >= 2 koneksi, keduanya menimpa
  `bot_relay/roster.json` bergantian dan envelope yang di-resolve dari roster
  versi Desktop bisa gagal terkirim oleh daemon (`runtime_offline` palsu),
  begitu pula sebaliknya. Untuk multi-koneksi, jadikan daemon satu-satunya
  relay (tutup Desktop atau terima flapping roster).
- `bot_relay.deliver` blocking sampai ~1320s per envelope (turn lock + turn
  timeout + 1 retry di sisi gateway); drain koneksi lain menunggu giliran,
  sama seperti perilaku plugin Desktop.
- Reply menunggu maksimal `REPLY_WAIT_SECONDS` (900s) di sisi pengirim; turn
  yang lebih lama dari itu tetap terkirim tapi waiter pengirim sudah timeout.
