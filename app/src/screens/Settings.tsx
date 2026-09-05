import { useState } from "react";
import type { ConnectionStore, HermesConnection, SavedConnection } from "../lib/hermes-client";
import Connections from "./Connections";

// Keep-in-sync dengan "version" di package.json — dibaca manual karena
// import package.json butuh resolveJsonModule + env khusus Vite.
const APP_VERSION = "0.1.0";

// Placeholder — repo belum dipublish; ganti saat URL final ada.
const REPO_URL = "https://github.com/iqbal/hermes-mobile";

export function Settings({
  conn,
  store,
  onConnect,
  onDisconnect,
}: {
  conn: SavedConnection;
  store: ConnectionStore;
  onConnect: (conn: SavedConnection, client: HermesConnection) => void;
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
        <div className="section-label">Active connection</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">{conn.label}</div>
            <span className="chip chip-green">Connected</span>
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
            Switch device
          </button>
        </div>

        <div className="section-label">Devices</div>
        <Connections store={store} onConnect={onConnect} embedded />

        <div className="section-label">Storage</div>
        <div className="card">
          <div className="hint" style={{ padding: 0 }}>
            Credentials (username &amp; password) are stored as plain text in
            this browser's localStorage. This is a v1 limitation — encrypted
            storage is still on the backlog. Don't use on shared devices.
          </div>
          <button
            className="btn btn-destructive"
            style={{ marginTop: 12 }}
            onClick={() => setConfirmWipe(true)}
          >
            Erase all local data
          </button>
        </div>

        <div className="section-label">Appearance</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">Chat text size</div>
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
            <span className="hint" style={{ padding: 0 }}>Small</span>
            <span className="hint" style={{ padding: 0 }}>Large</span>
          </div>
        </div>

        <div className="section-label">About</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">Hermes Mobile</div>
            <span className="chip">v{APP_VERSION}</span>
          </div>
          <div className="hint" style={{ padding: 0, marginTop: 4 }}>
            Unofficial client for Hermes-Agent.
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
            <div className="rowcard-title">Erase all local data?</div>
            <div className="hint" style={{ margin: "8px 0 14px" }}>
              All saved connections and other local data in this browser will
              be permanently erased, and the app will reload. This can't be
              undone.
            </div>
            <div className="sheet-actions">
              <button className="btn btn-destructive" onClick={wipeLocalData}>
                Erase &amp; reload
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmWipe(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
