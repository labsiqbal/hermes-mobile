import { useEffect, useState } from "react";
import {
  ConnectionStore,
  HermesConnection,
  newConnectionId,
  type SavedConnection,
} from "../lib/hermes-client";
import { MonitorIcon, PlusIcon, ServerIcon } from "../components/icons";

interface Props {
  store: ConnectionStore;
  onConnect: (conn: SavedConnection, client: HermesConnection) => void;
  /** Rendered inside the app shell (header already shows title) — skip the
   *  internal appbar. Standalone (pre-connect picker) keeps it. */
  embedded?: boolean;
}

type TestResult = { ok: boolean; text: string } | null;

/** Result of the unauthenticated /api/status liveness probe per device. */
type Probe = { online: boolean; version?: string };

/** localStorage key for the last successfully connected device — that one
 *  carries the green "default" chip (mockup layar 01). */
const LAST_CONN_KEY = "hermes-mobile.last-connected";

function readLastConnId(): string {
  try {
    return localStorage.getItem(LAST_CONN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Device glyph heuristic: rack-like machines get the server glyph, everything
 *  else the monitor glyph (design/index.html layar 01). */
function DeviceGlyph({ label }: { label: string }) {
  const Icon = /nuc|server|vps|raspi|\bpi\b/i.test(label) ? ServerIcon : MonitorIcon;
  return (
    <span className="glyph">
      <Icon size={17} />
    </span>
  );
}

export default function Connections({ store, onConnect, embedded }: Props) {
  const [connections, setConnections] = useState<SavedConnection[]>(() => store.list());
  const [showForm, setShowForm] = useState(connections.length === 0);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [lastConnId, setLastConnId] = useState(readLastConnId);

  function refresh() {
    setConnections(store.list());
  }

  // Liveness probe per saved device — /api/status is public, so this works
  // before login and drives the online/offline label on the right of each row.
  // A hard timeout keeps dead/mixed-content URLs from hanging on "…" forever.
  useEffect(() => {
    let cancelled = false;
    for (const conn of connections) {
      const client = new HermesConnection({ url: conn.url });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), 5000),
      );
      Promise.race([client.status(), timeout])
        .then((status) => {
          if (cancelled) return;
          const version = typeof status.version === "string" ? status.version : undefined;
          setProbes((prev) => ({ ...prev, [conn.id]: { online: true, version } }));
        })
        .catch(() => {
          if (!cancelled) setProbes((prev) => ({ ...prev, [conn.id]: { online: false } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [connections]);

  async function testConnection(target: {
    url: string;
    username: string;
    password: string;
  }): Promise<void> {
    const client = new HermesConnection(target);
    const status = await client.status();
    const version = typeof status.version === "string" ? status.version : "?";
    await client.login();
    setTestResult({ ok: true, text: `OK — Hermes ${version}, login accepted` });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await testConnection({ url: url.trim(), username: username.trim(), password });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function handleAdd() {
    const conn: SavedConnection = {
      id: newConnectionId(),
      label: label.trim() || url.trim(),
      url: url.trim().replace(/\/+$/, ""),
      username: username.trim(),
      password,
    };
    store.save(conn);
    refresh();
    setShowForm(false);
    setLabel("");
    setUrl("");
    setUsername("");
    setPassword("");
    setTestResult(null);
  }

  async function handleConnect(conn: SavedConnection) {
    setBusyId(conn.id);
    setError("");
    try {
      const client = new HermesConnection({
        url: conn.url,
        username: conn.username,
        password: conn.password,
      });
      await client.connect();
      try {
        localStorage.setItem(LAST_CONN_KEY, conn.id);
      } catch {
        /* private mode — the default chip just won't persist */
      }
      setLastConnId(conn.id);
      onConnect(conn, client);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const rows = (
    <>
      <div className="section-label">Tailnet · {connections.length} device</div>
      {connections.length === 0 && !showForm && (
        <div className="hint">No devices yet — add your first Hermes machine below.</div>
      )}
      {connections.map((conn) => {
        const probe = probes[conn.id];
        const busy = busyId === conn.id;
        return (
          <div
            key={conn.id}
            className="rowcard"
            role="button"
            tabIndex={0}
            onClick={() => {
                if (busyId === null) void handleConnect(conn);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && busyId === null) void handleConnect(conn);
              }}
            >
              <DeviceGlyph label={conn.label} />
              <div className="rowcard-main">
                <div className="title-row">
                  <div className="rowcard-title">{conn.label}</div>
                  {conn.id === lastConnId && <span className="chip chip-green">default</span>}
                </div>
                <div className="rowcard-meta">
                  {conn.url}
                  {probe?.version ? ` · hermes ${probe.version}` : ""}
                </div>
              </div>
              <span
                className={`conn-st ${
                  busy ? "conn-st-busy" : probe?.online ? "conn-st-on" : "conn-st-off"
                }`}
              >
                {busy ? "connecting…" : probe ? (probe.online ? "online" : "offline") : "…"}
              </span>
              <button
                className="iconbtn"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  store.remove(conn.id);
                  refresh();
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        {error && <div className="error-line">{error}</div>}

        {!showForm ? (
          <button className="btn btn-ghost btn-icon" onClick={() => setShowForm(true)}>
            <PlusIcon size={14} />
            Add device
          </button>
        ) : (
          <>
            <div className="section-label">Add device</div>
            <div className="card form-stack">
              <input
                className="field"
                placeholder="Label (e.g. linc-nuc)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                className="field mono"
                placeholder="https://node.tailnet.ts.net or http://100.x.x.x:9119"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                inputMode="url"
              />
              <input
                className="field"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <input
                className="field"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  disabled={testing || !url.trim()}
                  onClick={() => void handleTest()}
                >
                  {testing ? "Testing…" : "Test"}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!url.trim() || !username.trim() || !password}
                  onClick={() => void handleAdd()}
                >
                  Save
                </button>
              </div>
              {testResult && (
                <div className={testResult.ok ? "ok-line" : "error-line"}>{testResult.text}</div>
              )}
            </div>
            <div className="hint">
              Credentials are stored in this browser's localStorage (v1 — encrypted secure storage
              is backlog). Only use this app over your private tailnet.
            </div>
          </>
        )}
    </>
  );

  if (embedded) {
    return <>{rows}</>;
  }

  // Standalone pre-connect picker keeps its own appbar.
  return (
    <div className="screen">
      <div className="appbar">
        <div>
          <div className="appbar-title">Connections</div>
          <div className="appbar-sub">pick a machine on your tailnet</div>
        </div>
      </div>
      <div className="body">{rows}</div>
    </div>
  );
}
