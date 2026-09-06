import { useEffect, useRef, useState } from "react";
import { connectionLabel, isAppStorageKey } from "../lib/shell-state";
import type { ConnectionState, ConnectionStore, HermesConnection, SavedConnection } from "../lib/hermes-client";
import Connections from "./Connections";
import { applyScale, currentScale, setScale } from "../lib/appearance";

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
  const [scale, setScaleState] = useState(currentScale);
  const [appearanceSaved, setAppearanceSaved] = useState(true);
  function changeScale(value: string) {
    setAppearanceSaved(setScale(value));
    setScaleState(currentScale());
  }

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

        <div className="section-label">Appearance</div>
        <div className="card">
          <label className="appearance-scale" htmlFor="ui-scale">
            <span className="rowcard-title">UI scale</span>
            <select id="ui-scale" aria-label="UI scale" className="field" value={scale} onChange={event => changeScale(event.target.value)}>
              <option value="75">75% Compact</option>
              <option value="100">100% Standard</option>
              <option value="125">125% Large</option>
            </select>
          </label>
          <p className="hint">All screens, including chat text. Saved on this device only. Touch targets and text keep readable minimum sizes; browser zoom still works.</p>
          {!appearanceSaved && <p role="status" className="hint">Applied for now. Browser storage is unavailable; this choice may reset on reload.</p>}
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
