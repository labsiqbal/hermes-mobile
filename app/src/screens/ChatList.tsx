import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HermesConnection,
  SavedConnection,
  SessionSummary,
} from "../lib/hermes-client";
import {
  formatSessionTime,
  groupSessionsByTime,
  isRelaySession,
} from "./chat-list-utils";
import { botTint } from "./bots-utils";
import { isActive, pruneStale } from "../lib/active-sessions";

interface Props {
  conn: SavedConnection;
  client: HermesConnection;
  onOpenChat: (session: SessionSummary | null) => void; // null = new chat
  onDisconnect: () => void;
}

/** theme.css belum punya varian warm; trio tint/border/teks dari DESIGN.md. */
const RELAY_CHIP_STYLE = {
  background: "rgba(207, 128, 109, 0.12)",
  borderColor: "rgba(207, 128, 109, 0.22)",
  color: "var(--warm)",
} as const;

const LONG_PRESS_MS = 500;
/** Gerakan pointer di atas ini (px) membatalkan long-press (user sedang scroll). */
const LONG_PRESS_MOVE_TOLERANCE = 10;

export default function ChatList({ client, onOpenChat }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /** true saat long-press baru saja terpicu — menekan click susulan. */
  const longPressFired = useRef(false);

  const load = useCallback(async () => {
    try {
      setSessions(await client.listSessions());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
    pruneStale();
    return client.addStateHandler((state) => {
      if (state === "open") void load();
    });
  }, [client, load]);

  // Re-render list when active badges change (events fire globally in App).
  useEffect(() => {
    const t = setInterval(() => setSessions((prev) => [...prev]), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const onRowPointerDown = useCallback(
    (e: React.PointerEvent, s: SessionSummary) => {
      longPressFired.current = false;
      pressStart.current = { x: e.clientX, y: e.clientY };
      cancelPress();
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null;
        longPressFired.current = true;
        navigator.vibrate?.(10);
        setPendingDelete(s);
      }, LONG_PRESS_MS);
    },
    [cancelPress],
  );

  const onRowPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pressTimer.current || !pressStart.current) return;
      const dx = e.clientX - pressStart.current.x;
      const dy = e.clientY - pressStart.current.y;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOLERANCE ** 2) cancelPress();
    },
    [cancelPress],
  );

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target || deleting || isRelaySession(target)) return;
    setDeleting(true);
    try {
      await client.sessionDelete(target.id);
      // Optimistic: buang dari list lokal dulu, lalu refresh untuk
      // menyelaraskan dengan state server (chain compression dsb.).
      setSessions((prev) => prev.filter((s) => s.id !== target.id));
      setPendingDelete(null);
      setError("");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPendingDelete(null);
      void load();
    } finally {
      setDeleting(false);
    }
  }, [client, pendingDelete, deleting, load]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? sessions.filter((s) => (s.title || "").toLowerCase().includes(q))
      : sessions;
    return groupSessionsByTime(visible);
  }, [sessions, query]);

  const filtering = query.trim().length > 0;

  return (
    <div className="screen">
      <div className="body">
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => onOpenChat(null)}
          >
            + New chat
          </button>
          <button
            className="iconbtn"
            title="Muat ulang"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? "…" : "⟳"}
          </button>
        </div>
        <input
          className="field"
          type="search"
          placeholder="Cari sesi…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error && <div className="error-line">{error}</div>}
        {sessions.length === 0 && !error && (
          <div className="hint">Belum ada sesi di mesin ini. Mulai dari tombol di atas.</div>
        )}
        {sessions.length > 0 && groups.length === 0 && filtering && (
          <div className="hint">
            Tidak ada sesi yang cocok dengan “{query.trim()}”.
          </div>
        )}
        {groups.map((g) => (
          <Fragment key={g.label}>
            <div className="section-label">{g.label}</div>
            {g.sessions.map((s) => (
              <button
                key={s.id}
                className="rowcard"
                onClick={() => {
                  // Click susulan setelah long-press jangan membuka chat.
                  if (longPressFired.current) {
                    longPressFired.current = false;
                    return;
                  }
                  onOpenChat(s);
                }}
                onPointerDown={(e) => onRowPointerDown(e, s)}
                onPointerMove={onRowPointerMove}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
                onPointerLeave={cancelPress}
              >
                <span
                  className="sess-avatar"
                  style={{
                    background: botTint(s.title || "?").bg,
                    color: botTint(s.title || "?").fg,
                  }}
                >
                  {(s.title || "?").trim().charAt(0)}
                </span>
                <div className="rowcard-main">
                  <div className="rowcard-title">
                    {s.title || "Untitled"}
                    {isRelaySession(s) && (
                      <>
                        {" "}
                        <span className="chip" style={RELAY_CHIP_STYLE}>
                          relay
                        </span>
                      </>
                    )}
                    {isActive(s.id) && (
                      <>
                        {" "}
                        <span className="chip chip-amber chip-live">proses</span>
                      </>
                    )}
                  </div>
                  <div className="rowcard-sub">{s.preview || "—"}</div>
                </div>
                <div className="rowcard-meta" style={{ textAlign: "right" }}>
                  {formatSessionTime(s, g.label)}
                  <br />
                  {s.message_count} msg
                </div>
              </button>
            ))}
          </Fragment>
        ))}
      </div>
      {pendingDelete && (
        <>
          <div
            className="sheet-dim"
            onClick={() => {
              if (!deleting) setPendingDelete(null);
            }}
          />
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-grab" />
            {isRelaySession(pendingDelete) ? (
              <>
                <div className="rowcard-title">Sesi relay sistem</div>
                <div className="hint" style={{ margin: "8px 0 14px" }}>
                  “Bot Chat” adalah sesi relay Bot Mode milik sistem — tidak bisa
                  dihapus dari sini.
                </div>
                <div className="sheet-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={() => setPendingDelete(null)}
                  >
                    Tutup
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rowcard-title">Hapus sesi ini?</div>
                <div className="hint" style={{ margin: "8px 0 14px" }}>
                  “{pendingDelete.title || "Untitled"}” dan seluruh riwayatnya akan
                  dihapus permanen. Tidak bisa dibatalkan.
                </div>
                <div className="sheet-actions">
                  <button
                    className="btn btn-destructive"
                    disabled={deleting}
                    onClick={() => void confirmDelete()}
                  >
                    {deleting ? "Menghapus…" : "Hapus"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={deleting}
                    onClick={() => setPendingDelete(null)}
                  >
                    Batal
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
