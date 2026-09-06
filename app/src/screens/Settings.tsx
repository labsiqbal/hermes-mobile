import { useEffect, useRef, useState } from "react";
import { connectionLabel, isAppStorageKey } from "../lib/shell-state";
import type { ConnectionState, ConnectionStore, HermesConnection, SavedConnection } from "../lib/hermes-client";
import Connections from "./Connections";
import { ChevronRightIcon } from "../components/icons";
import { applyScale } from "../lib/appearance";

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
  onAppearance,
}: {
  conn: SavedConnection;
  state: ConnectionState;
  store: ConnectionStore;
  onConnect: (conn: SavedConnection, client: HermesConnection) => void;
  onDisconnect: () => void;
  onAppearance: () => void;
}) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wipeError, setWipeError] = useState('');
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!confirmWipe) return;
    const previous = document.activeElement;
    confirmation.current?.showModal();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [confirmWipe]);
  const wipeLocalData = () => {
    try {
      for (const storage of [localStorage, sessionStorage]) {
        const keys = Array.from({length:storage.length}, (_, i) => storage.key(i));
        for (const key of keys) if (key && isAppStorageKey(key)) storage.removeItem(key);
      }
      applyScale(100);
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
              fontSize: "var(--text-11_5)",
              color: "var(--fg-dim)",
              marginTop: "var(--space-4)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {conn.url}
          </div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: "var(--space-12)" }}
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
            style={{ marginTop: "var(--space-12)" }}
            onClick={() => setConfirmWipe(true)}
          >
            Erase Hermes Mobile data
          </button>
        </div>

        <button className="collection-link" onClick={onAppearance}>
          <span>Appearance</span><ChevronRightIcon size={18} />
        </button>

        <div className="section-label">About</div>
        <div className="card">
          <div className="title-row">
            <div className="rowcard-title">Hermes Mobile</div>
            <span className="chip">v{APP_VERSION}</span>
          </div>
          <div className="hint" style={{ padding: 0, marginTop: "var(--space-4)" }}>
            Unofficial client for Hermes-Agent.
          </div>
          <a
            className="mono"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              minHeight: 44,
              lineHeight: "44px",
              fontSize: "var(--text-11_5)",
              color: "var(--blue)",
              marginTop: "var(--space-8)",
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
