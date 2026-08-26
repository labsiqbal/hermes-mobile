import { useEffect, useState } from "react";
import {
  ConnectionStore,
  HermesConnection,
  type SavedConnection,
  type SessionSummary,
} from "../lib/hermes-client";
import { MonitorIcon, PlusIcon, ServerIcon } from "../components/icons";

interface Props {
  store: ConnectionStore;
  onConnect: (conn: SavedConnection, client: HermesConnection) => void;
  onOpenSession: (conn: SavedConnection, client: HermesConnection, session: SessionSummary) => void;
  onManageDevices: () => void;
}

type Probe = { online: boolean; version?: string };
type DeviceSessions = { sessions: SessionSummary[]; loading: boolean; error?: string };

function DeviceGlyph({ label }: { label: string }) {
  const Icon = /nuc|server|vps|raspi|\bpi\b/i.test(label) ? ServerIcon : MonitorIcon;
  return (
    <span className="glyph">
      <Icon size={17} />
    </span>
  );
}

async function fetchRecentSessions(conn: SavedConnection): Promise<SessionSummary[]> {
  const client = new HermesConnection({
    url: conn.url,
    username: conn.username,
    password: conn.password,
  });
  try {
    await client.connect();
    return await client.listSessions({ limit: 3 });
  } finally {
    client.disconnect();
  }
}

export default function Home({ store, onConnect, onOpenSession, onManageDevices }: Props) {
  const [connections] = useState<SavedConnection[]>(() => store.list());
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [deviceSessions, setDeviceSessions] = useState<Record<string, DeviceSessions>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Liveness probe per device (public /api/status, no auth needed).
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

  // Background fetch recent sessions per online device.
  useEffect(() => {
    let cancelled = false;
    for (const conn of connections) {
      const probe = probes[conn.id];
      if (!probe?.online) continue;
      if (deviceSessions[conn.id]?.loading || deviceSessions[conn.id]?.sessions.length) continue;

      setDeviceSessions((prev) => ({ ...prev, [conn.id]: { sessions: [], loading: true } }));
      fetchRecentSessions(conn)
        .then((sessions) => {
          if (cancelled) return;
          setDeviceSessions((prev) => ({ ...prev, [conn.id]: { sessions, loading: false } }));
        })
        .catch((err) => {
          if (cancelled) return;
          setDeviceSessions((prev) => ({
            ...prev,
            [conn.id]: { sessions: [], loading: false, error: err instanceof Error ? err.message : String(err) },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [connections, probes]);

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
      onConnect(conn, client);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSessionTap(conn: SavedConnection, session: SessionSummary) {
    setBusyId(conn.id);
    setError("");
    try {
      const client = new HermesConnection({
        url: conn.url,
        username: conn.username,
        password: conn.password,
      });
      await client.connect();
      onOpenSession(conn, client, session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="screen">
      <div className="appbar">
        <div>
          <div className="appbar-title">Home</div>
          <div className="appbar-sub">your tailnet devices</div>
        </div>
      </div>
      <div className="body">
        <div className="section-label">Devices · {connections.length}</div>
        {connections.length === 0 && (
          <div className="hint">No devices yet — add one from Connections.</div>
        )}
        {connections.map((conn) => {
          const probe = probes[conn.id];
          const busy = busyId === conn.id;
          const ds = deviceSessions[conn.id];
          return (
            <div key={conn.id} className="home-device-card">
              <div
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
                  <div className="rowcard-title">{conn.label}</div>
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
              </div>
              {probe?.online && ds && (
                <div className="home-sessions">
                  {ds.loading && <div className="hint">Loading sessions…</div>}
                  {ds.error && <div className="hint">Sessions unavailable</div>}
                  {!ds.loading && !ds.error && ds.sessions.length === 0 && (
                    <div className="hint">No recent sessions</div>
                  )}
                  {!ds.loading &&
                    !ds.error &&
                    ds.sessions.map((s) => (
                      <div
                        key={s.id}
                        className="home-session-row"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (busyId === null) void handleSessionTap(conn, s);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && busyId === null) {
                            e.stopPropagation();
                            void handleSessionTap(conn, s);
                          }
                        }}
                      >
                        <div className="home-session-title">{s.title || "Untitled"}</div>
                        <div className="home-session-preview">{s.preview || "—"}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {error && <div className="error-line">{error}</div>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-icon" onClick={onManageDevices}>
          <PlusIcon size={14} />
          Manage devices
        </button>
      </div>
    </div>
  );
}
