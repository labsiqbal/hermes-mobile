---
name: Hermes Mobile
description: Client tipis dark-mode untuk Hermes agent self-hosted — plumbing agent (tool calls, approval, delegasi bot) adalah konten utama.
colors:
  chrome: "#0d0d0e"
  page: "#070708"
  sidebar: "#0a0a0b"
  card: "#161618"
  elevated: "#1c1c1f"
  fg: "#f2f2f3"
  fg-dim: "#a7a7ad"
  fg-faint: "#6d6d74"
  line: "rgba(255,255,255,.08)"
  line-soft: "rgba(255,255,255,.05)"
  blue: "#4f8cff"
  blue-deep: "#0053fd"
  warm: "#cf806d"
  amber: "#ffd24a"
  green: "#55a583"
  red: "#e75e78"
  cyan: "#6f9ba6"
typography:
  display:
    fontFamily: "'Segoe WPC', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Segoe WPC', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Segoe WPC', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  chip: "6px"
  badge: "7px"
  cmd: "8px"
  iconbtn: "9px"
  row: "10px"
  button: "12px"
  card: "14px"
  sheet: "20px"
  phone: "34px"
spacing:
  xs: "8px"
  sm: "10px"
  md: "14px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.blue-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.button}"
    padding: "12px"
    typography: "{typography.title}"
  button-ghost:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg-dim}"
    rounded: "{rounded.button}"
    padding: "12px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "13px 14px"
  chip:
    backgroundColor: "rgba(111,155,166,.12)"
    textColor: "{colors.cyan}"
    rounded: "{rounded.chip}"
    padding: "2.5px 7px"
    typography: "{typography.label}"
  input-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg-faint}"
    rounded: "{rounded.button}"
    padding: "10px 13px"
  sheet:
    backgroundColor: "{colors.elevated}"
    rounded: "{rounded.sheet}"
    padding: "10px 18px 22px"
---

# Design System: Hermes Mobile

## Overview

**Creative North Star: "The Relay Console"**

Hermes Mobile adalah layar tipis ke agent self-hosted — HP bukan tempat komputasi, hanya jendela ke mesin-mesin user di tailnet. Karena itu bahasa visualnya konsol, bukan messenger: plumbing agent (tool calls, approval, delegasi bot, route relay) tampil sebagai konten kelas satu, tidak disembunyikan di balik bubble chat. Dunianya diwarisi utuh dari Hermes Desktop — chrome nyaris-hitam, kartu gelap, hairline border translusen — dengan densitas yang dikecilkan untuk layar 340px.

Aksen warna bekerja seperti sinyal status, bukan dekorasi: biru untuk aksi dan pesan user, warm untuk identitas Bot Mode, amber untuk perintah yang menunggu keputusan, hijau untuk sukses/online, merah untuk tolak/stop, cyan untuk handle dan metadata mesin. Tidak ada glow, tidak ada gradient, tidak ada bayangan di dalam app — kedalaman dibangun murni dari tumpukan tonal (page → chrome → card → elevated) plus garis rambut putih 5–8%.

**Key Characteristics:**
- Dark-by-context: dipakai malam/dim, semua surface nyaris hitam dengan kontras teks tinggi.
- Plumbing terlihat: toolcard, approval sheet, dan relay route adalah hero, bukan detail tersembunyi.
- Bot Mode warga kelas satu: roster, compose delegasi, dan thread relay punya komponen khusus sendiri.
- Multi-device eksplisit: nama device dan IP selalu terlihat (appbar subtitle, device switch, section header).
- Mono adalah data: JetBrains Mono hanya untuk handle, perintah, IP, ID — bukan kostum tipografi.

## Colors

Palet gelap beraksen tunggal: satu keluarga netral nyaris-hitam di bawah, enam warna sinyal jenuh-sedang di atasnya, masing-masing dengan makna tetap.

### Primary
- **Signal Blue** (`#4f8cff`): pesan user (bubble tint 16%), tab aktif, kursor streaming, chip biru. Versi terang dari aksi utama, dipakai sebagai tint/foreground.
- **Deep Action Blue** (`#0053fd`): satu-satunya fill solid jenuh di sistem — tombol primary, tombol send, tombol Approve. Selalu dengan teks putih.

### Secondary
- **Relay Warm** (`#cf806d`): identitas Bot Mode — avatar bot, chip `relay`, badge tab Bots, status `wait` yang berdenyut, aksen judul. Warm = "ini jalur antar-agent".

### Tertiary
- **Pending Amber** (`#ffd24a`): perintah terminal di toolcard dan approval sheet (teks amber di atas tint amber 6%), ikon warning, dot `busy`. Amber = "menunggu / butuh keputusan".
- **OK Green** (`#55a583`): dot online, `exit 0`, reply-card dari bot (border + tint hijau), avatar sukses.
- **Stop Red** (`#e75e78`): tombol Tolak (border + teks saja, tanpa fill), tombol stop streaming (tint merah 14%). Tidak pernah jadi fill penuh.
- **Machine Cyan** (`#6f9ba6`): handle `@bot`, node relay-route, IP/metadata mono, chip default. Cyan = "ini identifier mesin/agent".

### Neutral
- **Chrome** (`#0d0d0e`): latar utama di dalam phone frame.
- **Page** (`#070708`): latar board/presentasi di luar frame — lebih gelap dari chrome.
- **Sidebar** (`#0a0a0b`): tabbar — sedikit lebih gelap dari chrome agar menekan ke bawah.
- **Card** (`#161618`): surface konten standar (row, bubble bot container, field composer).
- **Elevated** (`#1c1c1f`): surface di atas kartu — sheet approval, glyph device, node relay.
- **Foreground** (`#f2f2f3`): teks utama.
- **Dim Foreground** (`#a7a7ad`): teks sekunder, ikon, preview pesan.
- **Faint Foreground** (`#6d6d74`): metadata mono, placeholder, timestamp.
- **Line** (`rgba(255,255,255,.08)`): border untuk elemen interaktif (field, ghost button, sheet top).
- **Soft Line** (`rgba(255,255,255,.05)`): border default kartu, divider, pemisah appbar/tabbar.

### Named Rules
**The Signal Tint Rule.** Warna aksen tidak pernah jadi fill solid kecuali Deep Action Blue. Semua aksen lain tampil sebagai trio: tint 6–16% + border 12–40% + teks warna aksen. Contoh: chip, bubble user, target-card, reply-card, tombol stop.

**The One Fill Rule.** Hanya satu elemen ber-fill biru solid per layar (primary CTA atau send button). Kalau ada dua, salah satunya harus turun jadi ghost.

**The Amber Owns Commands Rule.** Perintah yang akan/menunggu dieksekusi selalu amber mono di atas tint amber — di toolcard maupun approval sheet. Amber tidak boleh dipakai untuk hal lain.

## Typography

**Display Font:** system sans stack ala Hermes Desktop (`'Segoe WPC', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`)
**Body Font:** sama — satu stack untuk semua teks
**Label/Mono Font:** JetBrains Mono (dengan `ui-monospace, monospace`)

**Character:** Sans system yang rapat dan netral membawa semua narasi; JetBrains Mono masuk hanya saat kontennya data — handle, perintah, IP, ID envelope, timestamp. Mono di sini sinyal "ini bisa disalin/dieksekusi", bukan gaya.

### Hierarchy
- **Display** (700, 17px, -0.015em): judul appbar layar utama ("Chats", "Bots").
- **Title** (600–700, 13.5–14px, -0.01em): nama device/sesi, judul sheet, judul appbar dalam.
- **Body** (400, 11.5–12.5px, 1.5–1.55): deskripsi bot dan hint line. Isi pesan dan composer memakai 13px secara default, dapat diatur 11–16px dari Settings.
- **Label** (600, 9.5–11px mono): handle, chip, metadata, section header (uppercase, letter-spacing .08em), timestamp.

### Named Rules
**The Mono Is Data Rule.** JetBrains Mono hanya untuk data mesin: `@handle`, `npm run build`, `100.64.0.14`, `ttl 900s`. Prosa tidak pernah mono; mono tidak pernah untuk dekorasi.

**The Small Screen Scale Rule.** Semua ukuran di bawah 18px — tidak ada display type besar di dalam app. Teks terbesar (17px) hanya untuk judul layar; teks terkecil (8.5px) hanya untuk badge angka di tab.

## Layout

Setiap layar hidup dalam phone frame 340×720px (radius 34px) dengan struktur vertikal tetap: statusbar (34px) → appbar → body scroll → composer/tabbar. Appbar layar dalam selalu menjaga konteks mesin. Pada ChatView, appbar membawa tombol kembali, judul, chip model, subtitle mesin atau room, aksi chat baru, dan menu opsi chat.

Body memakai padding 16px, gap antar elemen 8–14px, dan pola penumpukan yang sama di semua layar: section header mono uppercase → kartu → kartu → hint line. Daftar selalu berbasis kartu penuh (bukan divider list). Sheet approval menempel di bawah sebagai overlay absolut dengan dim gelap di atas seluruh layar.

## Elevation & Depth

Di dalam app: **tanpa bayangan sama sekali**. Kedalaman dibangun dari tangga tonal lima anak (page → chrome → sidebar/card → elevated) plus hairline border putih 5–8%. Satu-satunya "depth" tambahan adalah dim overlay sheet (`rgba(4,4,5,.55)`) yang menggelapkan konten di belakangnya.

### Shadow Vocabulary
- **Phone Frame** (`0 24px 60px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4)`): hanya untuk frame HP di board presentasi — bukan bagian dari bahasa app.

### Named Rules
**The Flat-Inside Rule.** Tidak ada `box-shadow` pada elemen apa pun di dalam phone frame. Butuh elemen terangkat? Naikkan satu anak tangga tonal (card → elevated), jangan tambahkan bayangan.

**The Dim Sheet Rule.** Modal/sheet tidak memakai blur atau shadow; ia mengambang karena konten di belakangnya digelapkan 55% dan sheet sendiri naik ke `elevated` dengan border-top `line`.

## Shapes

Bahasa bentuk: rounded lembut yang mengecil seiring ukuran elemen. Kartu dan container utama 14px; tombol, toolcard, dan field 12px; row kecil (device switch, avatar sesi, blok perintah) 10px; ikon-button 9px; node relay 7px; chip 6px. Sheet hanya membulat di dua sudut atas (20px). Status dot dan badge selalu lingkaran/pill penuh. Tidak ada sudut tajam, tidak ada bentuk miring/dekoratif — siluet selalu persegi-membulat fungsional.

Border selalu hairline 1px translusen putih; tidak ada border opaque abu-abu, tidak ada outline tebal.

## Components

### Buttons
- **Shape:** membulat penuh (12px).
- **Primary:** fill Deep Action Blue (`#0053fd`), teks putih 13.5px/600–700, padding 12px, ikon + label di tengah. Dipakai untuk CTA utama layar ("Kirim via @hermes", "Approve").
- **Ghost:** fill Card + border `line`, teks dim — untuk aksi sekunder ("Tambah device").
- **Destructive:** transparan + border merah 40% + teks merah ("Tolak") — tidak pernah fill merah.

### Chips
- **Style:** mono 9.5px, tint aksen 12% + border aksen 20–22% + teks aksen; radius 6px; padding 2.5px 7px; lowercase, nowrap.
- **Variants:** `cyan` (default/metadata), `warm` (relay/Bot Mode), `blue` (info), `green` (sukses/`exit 0`).

### Cards / Containers
- **Corner Style:** membulat (14px).
- **Background:** Card (`#161618`); varian "sunken" untuk toolcard/relay-card: `color-mix(in srgb, var(--card) 88%, #000)`.
- **Shadow Strategy:** none — lihat The Flat-Inside Rule.
- **Border:** 1px `line-soft`.
- **Internal Padding:** 13px 14px (row), 10–12px (kartu inline di dalam pesan).

### Status Dots
- **Style:** lingkaran 8px; `on` hijau, `busy` amber, `off` abu (`#4a4a50`), `wait` warm dengan pulse opacity 1↔.35 (1.6s ease-in-out infinite). Di avatar bot, dot diberi ring 2px warna kartu agar terbaca di tepi.

### Tool Cards (signature)
- **Character:** bukti eksekusi, tampil inline di dalam bubble bot sebagai kartu sunken.
- **Structure:** header (ikon terminal + nama tool + durasi + chip status) → blok perintah (mono amber di tint amber 6%, border amber 12%, ellipsis) → output (mono faint 9.5px, baris sukses hijau). Tool terlihat secara default tetapi detailnya collapsed; menu chat mengatur show/hide, expand/collapse all, dan pilihan card atau CLI. Pilihan visibilitas, mode, dan ekspansi per tool disimpan lokal.

### Relay Cards (signature)
- **Character:** amplop Bot Mode yang divisualkan — route, bukan sekadar status.
- **Structure:** header (`message_agent` + status) → relay-route: node mono cyan di chip Elevated, dihubungkan panah hop → baris status dengan dot `wait` berdenyut + metadata mono (`ttl 900s · id 8f3a…`).

### Reply Cards (signature)
- **Character:** jawaban async dari bot lain — satu-satunya kartu beraksen hijau penuh.
- **Style:** border hijau 28% + tint hijau 7%, header hijau ("Reply dari @handle"), body teks utama dengan data inline mono cyan. Dipisahkan dari turn sebelumnya oleh turn-divider mono uppercase dengan hairline kiri-kanan.

### Approval Sheet (signature)
- **Character:** interupsi keputusan — muncul dari bawah di atas dim 55%.
- **Structure:** grab pill 36×4px → judul 14px/700 + ikon warning amber → subjudul (device ditandai tebal) → blok perintah mono amber di surface `#101012` → dua aksi sejajar: Tolak (destructive outline) + Approve (primary blue).

### Inputs / Composer
- **Chat composer:** pill mengambang dengan input satu baris dan aksi bundar di kanan. Aksi berubah dari kirim menjadi stop selama turn aktif; tidak ada kontrol voice sampai fitur itu benar-benar tersedia.
- **Sizing:** teks pesan dan composer mengikuti ukuran chat dari Settings (11–16px, default 13px); label, metadata, dan isi tool tetap memakai skala tetap agar hierarki tidak berubah.
- **Style:** surface Card + border `line-soft`, radius 24px, placeholder faint; tombol send = lingkaran 36px fill Deep Action Blue. Saat streaming, tombol stop 36px tint merah 20% + border merah 30% menggantikan send.
- **Focus:** pertahankan batas hairline tanpa glow; fokus keyboard tidak boleh mengubah geometri composer.

### Navigation
- **Tabbar:** tinggi 58px, background Sidebar, border-top `line-soft`. Tab = ikon 19px + label 10px/600; default faint, aktif Signal Blue (tanpa indikator tambahan). Badge notifikasi: pill warm 7px dengan angka mono 8.5px, menempel di sudut ikon.
- **Appbar:** judul Display + iconbtn 32px (Card + `line-soft`, ikon dim, radius 9px). Layar dalam: tombol back + judul Title + subtitle mono faint/warm yang selalu menyebut device.

### Phone Frame (board only)
- Frame presentasi 340×720, radius 34px, border putih 9%, satu-satunya elemen bersistem yang memakai drop shadow. Status bar 34px dengan jam 11.5px/600 dan ikon sinyal/baterai SVG inline.

## Do's and Don'ts

### Do:
- **Do** tampilkan nama device + IP di setiap konteks yang berganti mesin (appbar subtitle, device switch, section header roster) — multi-device harus eksplisit.
- **Do** render tool calls, relay envelope, dan approval sebagai kartu terstruktur dengan header + isi mono — plumbing adalah konten.
- **Do** pakai trio tint + border + teks aksen untuk semua elemen berwarna selain tombol primary (contoh: `rgba(79,140,255,.16)` + border `.22` + teks biru untuk bubble user).
- **Do** pakai JetBrains Mono untuk handle, perintah, IP, ID, timestamp — dan hanya untuk itu.
- **Do** pisahkan reply async bot dengan turn-divider mono uppercase + hairline, agar jeda waktu terbaca sebagai bagian dari cerita.
- **Do** naikkan tonal surface (card → elevated) untuk menyatakan elemen berada di atas, bukan memakai bayangan.

### Don't:
- **Don't** pakai glow zero-offset atau `box-shadow` apa pun di dalam app — depth murni tonal + hairline.
- **Don't** pakai gradient text atau gradient fill — semua warna solid atau tint alpha tunggal.
- **Don't** jadikan warna aksen fill solid kecuali Deep Action Blue pada CTA; merah dan hijau tidak pernah jadi background penuh.
- **Don't** pakai JetBrains Mono sebagai kostum untuk prosa, judul, atau label UI — mono = data mesin.
- **Don't** sembunyikan status relay/approval di balik bubble chat polos atau toast; setiap delegasi bot menampilkan route dan TTL-nya.
- **Don't** pakai border opaque abu-abu — semua garis hairline putih translusen (`.05`–`.08`).
- **Don't** tambahkan warna baru di luar enam warna sinyal; makna warna sudah tetap dan silang-makna merusak legibilitas konsol.
