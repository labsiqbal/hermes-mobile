import { useEffect, useRef, useState } from "react";
import { connectionLabel, isAppStorageKey } from "../lib/shell-state";
import type { ConnectionState, ConnectionStore, HermesConnection, SavedConnection } from "../lib/hermes-client";
import Connections from "./Connections";

// Keep-in-sync dengan "version" di package.json — dibaca manual karena
// import package.json butuh resolveJsonModule + env khusus Vite.
const APP_VERSION = "0.1.0";

const REPO_URL = "https://github.com/labsiqbal/hermes-mobile";

export function Settings({
  conn,
  state,
  store,
  onConnect,
  onDisconnect,
}: {
  conn: SavedConnection;
  state: ConnectionState;
  store: ConnectionStore;
  onConnect: (conn: SavedConnection, client: HermesConnection) => void;
  onDisconnect: () => void;
}) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wipeError, setWipeError] = useState('');
  const confirmation = useRef<HTMLDialogElement>(null);
  const [accent, setAccent] = useState(() => document.documentElement.style.getPropertyValue('--scratch-accent') || '#99baff');
  const [accentEnabled, setAccentEnabled] = useState(() => Boolean(document.documentElement.style.getPropertyValue('--scratch-accent')));
  function scratchAccent(color: string, enabled: boolean) {
    setAccent(color); setAccentEnabled(enabled);
    if (enabled) document.documentElement.style.setProperty('--scratch-accent', color);
    else document.documentElement.style.removeProperty('--scratch-accent');
  }
  useEffect(() => {
    if (!confirmWipe) return;
    const previous = document.activeElement;
    confirmation.current?.showModal();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [confirmWipe]);
  const [fontSize, setFontSizeState] = useState(() => {
    try {
      return parseFloat(localStorage.getItem("hermes-mobile.font-size") || "15");
    } catch {
      return 15;
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
    try {
      for (const storage of [localStorage, sessionStorage]) {
        const keys = Array.from({length:storage.length}, (_, i) => storage.key(i));
        for (const key of keys) if (key && isAppStorageKey(key)) storage.removeItem(key);
      }
      onDisconnect();
      location.reload();
    } catch {
      setWipeError('Browser storage could not be fully erased. Check browser permissions and try again.');
    }
  };

  return (
    <div className="screen">
      <div className="body">
        <div className="section-label">Active connection</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">{conn.label}</div>
            <span className={`chip ${state === "open" ? "chip-green" : "chip-amber"}`}>{connectionLabel(state)}</span>
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
            Erase Hermes Mobile data
          </button>
        </div>

        <div className="section-label">Appearance</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">Chat text size</div>
            <span className="chip">{fontSize}px</span>
          </div>
          <input
            aria-label="Chat text size"
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

        <div className="card scratch-accent">
          <div className="rowcard-title">Scratch accent</div>
          <p className="hint">A temporary accent for tab indicators and decorative edges. Text and status colors stay readable. This does not change your gateway or profile; reloading restores the authored defaults.</p>
          <label className="accent-control"><input type="checkbox" checked={accentEnabled} onChange={event => scratchAccent(accent, event.target.checked)} />Enable scratch accent</label>
          <label className="accent-control">Accent color<input type="color" aria-label="Scratch accent color" value={accent} onChange={event => scratchAccent(event.target.value, true)} /></label>
          <button className="btn btn-ghost" onClick={() => scratchAccent('#99baff', false)}>Restore authored defaults</button>
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
          <dialog ref={confirmation} className="command-palette wipe-dialog" aria-labelledby="wipe-title" onCancel={() => setConfirmWipe(false)}>
            <div className="sheet-grab" />
            <h2 id="wipe-title">Erase Hermes Mobile data?</h2>
            <div className="hint" style={{ margin: "8px 0 14px" }}>
              Hermes Mobile connections, credentials, rooms, drafts and preferences on this browser will be erased, and the app will reload. Other applications on this origin and all remote gateway data are untouched. This cannot be undone.
            </div>
            {wipeError && <p role="alert" className="error-line">{wipeError}</p>}
            <div className="sheet-actions">
              <button className="btn btn-destructive" onClick={wipeLocalData}>
                Erase &amp; reload
              </button>
              <button
                autoFocus
                className="btn btn-ghost"
                onClick={() => setConfirmWipe(false)}
              >
                Cancel
              </button>
            </div>
          </dialog>
      )}
    </div>
  );
}
