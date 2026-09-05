import { useEffect, useState } from "react";
import {
  ConnectionStore,
  HermesConnection,
  type ConnectionState,
  type SavedConnection,
  type SessionSummary,
} from "../lib/hermes-client";
import { MonitorIcon, PlusIcon, ServerIcon } from "../components/icons";
import { botTint } from "./bots-utils";
import { connectionLabel } from "../lib/shell-state";

interface Props {
  store: ConnectionStore;
  /** The device currently connected — shown as the hero card with sessions. */
  conn: SavedConnection;
  /** Live client of the connected device (no reconnect needed for its rows). */
  client: HermesConnection;
  state: ConnectionState;
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

/** Short timestamp for a session row — time today, weekday this week, date older. */
function rowTime(s: SessionSummary): string {
  const t = (s.started_at ?? 0) * 1000;
  if (!t) return "";
  const d = new Date(t);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (t >= startToday) return `${hh}:${mm}`;
  if (t >= startToday - 6 * 86_400_000) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  }
  return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`;
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

/** Board body — rendered inside the app shell (Header + TabBar come from App). */
export default function Home({ store, conn, client, state, onConnect, onOpenSession, onManageDevices }: Props) {
  const [connections] = useState<SavedConnection[]>(() => store.list());
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [deviceSessions, setDeviceSessions] = useState<Record<string, DeviceSessions>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const others = connections.filter((c) => c.id !== conn.id);

  // Liveness probe per other device (public /api/status, no auth needed).
  useEffect(() => {
    let cancelled = false;
    for (const other of others) {
      const probe = new HermesConnection({ url: other.url });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), 5000),
      );
      Promise.race([probe.status(), timeout])
        .then((status) => {
          if (cancelled) return;
          const version = typeof status.version === "string" ? status.version : undefined;
          setProbes((prev) => ({ ...prev, [other.id]: { online: true, version } }));
        })
        .catch(() => {
          if (!cancelled) setProbes((prev) => ({ ...prev, [other.id]: { online: false } }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recent sessions of the connected device — straight through the live client.
  useEffect(() => {
    let cancelled = false;
    setDeviceSessions((prev) => ({ ...prev, [conn.id]: { sessions: [], loading: true } }));
    client
      .listSessions({ limit: 3 })
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
    return () => {
      cancelled = true;
    };
  }, [conn.id, client, state]);

  // Recent sessions of online OTHER devices (background, own short-lived client).
  useEffect(() => {
    let cancelled = false;
    for (const other of others) {
      const probe = probes[other.id];
      if (!probe?.online) continue;
      if (deviceSessions[other.id]?.loading || deviceSessions[other.id]?.sessions.length) continue;

      setDeviceSessions((prev) => ({ ...prev, [other.id]: { sessions: [], loading: true } }));
      fetchRecentSessions(other)
        .then((sessions) => {
          if (cancelled) return;
          setDeviceSessions((prev) => ({ ...prev, [other.id]: { sessions, loading: false } }));
        })
        .catch(() => {
          if (cancelled) return;
          setDeviceSessions((prev) => ({
            ...prev,
            [other.id]: { sessions: [], loading: false, error: 'Sessions unavailable' },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probes]);

  function handleSessionTap(target: SavedConnection, session: SessionSummary) {
    if (busyId !== null) return;
    // Connected device: reuse the live client — no reconnect, instant open.
    if (target.id === conn.id) {
      onOpenSession(target, client, session);
      return;
    }
    setBusyId(target.id);
    setError("");
    const fresh = new HermesConnection({
      url: target.url,
      username: target.username,
      password: target.password,
    });
    fresh
      .connect()
      .then(() => onOpenSession(target, fresh, session))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyId(null));
  }

  async function handleSwitchTo(target: SavedConnection) {
    if (busyId !== null) return;
    setBusyId(target.id);
    setError("");
    try {
      const fresh = new HermesConnection({
        url: target.url,
        username: target.username,
        password: target.password,
      });
      await fresh.connect();
      onConnect(target, fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  function renderDeviceCard(target: SavedConnection, active: boolean) {
    const sessions = deviceSessions[target.id];
    return (
      <div key={target.id} className="board-card">
        <div
          className="board-device"
          role={active ? undefined : "button"}
          tabIndex={active ? undefined : 0}
          onClick={active ? undefined : () => void handleSwitchTo(target)}
          onKeyDown={
            active
              ? undefined
              : (e) => {
                  if (e.key === "Enter") void handleSwitchTo(target);
                }
          }
        >
          <DeviceGlyph label={target.label} />
          <div className="rowcard-main">
            <div className="board-dev-name">{target.label}</div>
            <div className="board-dev-url">
              {target.url}
              {active && probes[target.id]?.version ? ` · hermes ${probes[target.id]?.version}` : ""}
            </div>
          </div>
          <span
            className={`st-pill ${
              busyId === target.id
                ? "st-busy"
                : (active ? state === "open" : probes[target.id]?.online)
                  ? "st-on"
                  : probes[target.id]
                    ? "st-off"
                    : ""
            }`}
          >
            {busyId === target.id
              ? "connecting…"
              : active
                ? connectionLabel(state)
                : probes[target.id]
                  ? probes[target.id].online
                    ? "Reachable"
                    : "Unavailable"
                  : "…"}
          </span>
        </div>
        {sessions && (
          <>
            {sessions.loading && <div className="hint board-sess-hint">Loading sessions…</div>}
            {sessions.sessions.map((s) => {
              const tint = botTint(s.title || "?");
              return (
                <div
                  key={s.id}
                  className="board-sess"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSessionTap(target, s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSessionTap(target, s);
                  }}
                >
                  <span className="board-sess-ava" style={{ background: tint.bg, color: tint.fg }}>
                    {(s.title || "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="board-sess-main">
                    <div className="board-sess-t">{s.title || "Untitled"}</div>
                    <div className="board-sess-p">{s.preview || "—"}</div>
                  </div>
                  <span className="board-sess-when">{rowTime(s)}</span>
                </div>
              );
            })}
            {!sessions.loading && sessions.sessions.length === 0 && (
              <div className="hint board-sess-hint">
                {sessions.error ? "Sessions unavailable" : "No recent sessions"}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="body board">
      <div className="shell-hero"><div className="eyebrow">Your personal relay</div><h2>Your work,<br />within reach.</h2><p>A quiet window into your devices. Open a conversation to find its workspace tools.</p></div>
      <div className="section-label">
        Devices · {others.length + 1}
      </div>
      {renderDeviceCard(conn, true)}
      {others.map((other) => renderDeviceCard(other, false))}
      {error && <div className="error-line">{error}</div>}
      <button className="board-add" onClick={onManageDevices}>
        <PlusIcon size={15} />
        Add device
      </button>
    </div>
  );
}
