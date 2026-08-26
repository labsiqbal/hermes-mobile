import { useState } from "react";
import type { SavedConnection } from "../lib/hermes-client";

// Keep-in-sync dengan "version" di package.json — dibaca manual karena
// import package.json butuh resolveJsonModule + env khusus Vite.
const APP_VERSION = "0.1.0";

// Placeholder — repo belum dipublish; ganti saat URL final ada.
const REPO_URL = "https://github.com/iqbal/hermes-mobile";

export function Settings({
  conn,
  onDisconnect,
}: {
  conn: SavedConnection;
  onDisconnect: () => void;
}) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [fontSize, setFontSizeState] = useState(() => {
    try {
      return parseFloat(localStorage.getItem("hermes-mobile.font-size") || "13");
    } catch {
      return 13;
    }
  });

  const setFontSize = (size: number) => {
    setFontSizeState(size);
    try {
      localStorage.setItem("hermes-mobile.font-size", String(size));
    } catch {
      /* ignore */
    }
    // Apply to CSS variable
    document.documentElement.style.setProperty("--chat-font-size", `${size}px`);
  };

  const wipeLocalData = () => {
    localStorage.clear();
    onDisconnect();
    location.reload();
  };

  return (
    <div className="screen">
      <div className="body">
        <div className="section-label">Koneksi aktif</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">{conn.label}</div>
            <span className="chip chip-green">Terhubung</span>
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11.5,
              color: "var(--fg-dim)",
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {conn.url}
          </div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: 12 }}
            onClick={onDisconnect}
          >
            Ganti device
          </button>
        </div>

        <div className="section-label">Penyimpanan</div>
        <div className="card">
          <div className="hint" style={{ padding: 0 }}>
            Kredensial (username &amp; password) disimpan sebagai teks biasa di
            localStorage browser ini. Ini keterbatasan v1 — penyimpanan
            terenkripsi masih di backlog. Jangan pakai di perangkat bersama.
          </div>
          <button
            className="btn btn-destructive"
            style={{ marginTop: 12 }}
            onClick={() => setConfirmWipe(true)}
          >
            Hapus semua data lokal
          </button>
        </div>

        <div className="section-label">Tampilan</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">Ukuran teks chat</div>
            <span className="chip">{fontSize}px</span>
          </div>
          <input
            type="range"
            min={11}
            max={16}
            step={0.5}
            value={fontSize}
            onChange={(e) => setFontSize(parseFloat(e.target.value))}
            style={{ width: "100%", marginTop: 8 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span className="hint" style={{ padding: 0 }}>Kecil</span>
            <span className="hint" style={{ padding: 0 }}>Besar</span>
          </div>
        </div>

        <div className="section-label">Tentang</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">Hermes Mobile</div>
            <span className="chip">v{APP_VERSION}</span>
          </div>
          <div className="hint" style={{ padding: 0, marginTop: 4 }}>
            Klien unofficial untuk Hermes-Agent.
          </div>
          <a
            className="mono"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              fontSize: 11.5,
              color: "var(--blue)",
              marginTop: 8,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {REPO_URL}
          </a>
        </div>
      </div>

      {confirmWipe && (
        <>
          <div className="sheet-dim" onClick={() => setConfirmWipe(false)} />
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-grab" />
            <div className="rowcard-title">Hapus semua data lokal?</div>
            <div className="hint" style={{ margin: "8px 0 14px" }}>
              Seluruh koneksi tersimpan dan data lokal lain di browser ini akan
              dihapus permanen, lalu aplikasi dimuat ulang. Tidak bisa
              dibatalkan.
            </div>
            <div className="sheet-actions">
              <button className="btn btn-destructive" onClick={wipeLocalData}>
                Hapus &amp; muat ulang
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmWipe(false)}
              >
                Batal
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
