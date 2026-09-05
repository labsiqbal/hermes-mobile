import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HermesConnection,
  ProjectTreeItem,
  SavedConnection,
  SessionSummary,
} from "../lib/hermes-client";
import {
  formatSessionTime,
  isRelaySession,
} from "./chat-list-utils";
import { botTint } from "./bots-utils";
import { isActive } from "../lib/active-sessions";
import { ChevronDownIcon, ChevronRightIcon } from "../components/icons";

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

export default function ChatList({ conn, client, onOpenChat }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectTreeItem[]>([]);
  const [scopedIds, setScopedIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState<Record<string, ProjectTreeItem>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(`hermes-projects-expanded:${conn.id}`) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const [loadingProject, setLoadingProject] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /** true saat long-press baru saja terpicu — menekan click susulan. */
  const longPressFired = useRef(false);

  const load = useCallback(async () => {
    try {
      const [nextSessions, tree] = await Promise.all([
        client.listSessions(),
        client.projectTree().catch(() => ({ projects: [], scoped_session_ids: [] })),
      ]);
      setSessions(nextSessions);
      setProjects(tree.projects);
      setScopedIds(new Set(tree.scoped_session_ids ?? []));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Sync initial gateway state on mount.
    void load();
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

  const projectSessions = useCallback((project: ProjectTreeItem): SessionSummary[] => {
    const full = hydrated[project.id];
    const rows = full?.repos?.flatMap((repo) =>
      (repo.groups ?? []).flatMap((lane) => lane.sessions ?? []),
    ) ?? project.previewSessions ?? [];
    return [...new Map(rows.map((session) => [session.id, session])).values()];
  }, [hydrated]);

  const toggleProject = useCallback(async (project: ProjectTreeItem) => {
    const opening = !expanded.has(project.id);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (opening) next.add(project.id);
      else next.delete(project.id);
      localStorage.setItem(`hermes-projects-expanded:${conn.id}`, JSON.stringify([...next]));
      return next;
    });
    if (!opening || hydrated[project.id] || project.sessionCount === 0) return;
    setLoadingProject(project.id);
    try {
      const full = await client.projectSessions(project.id);
      if (full) setHydrated((previous) => ({ ...previous, [project.id]: full }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProject(null);
    }
  }, [client, conn.id, expanded, hydrated]);

  const projectRows = useMemo(() => projects
    // Daftar chat hanya menampilkan proyek nyata yang berisi percakapan.
    .filter((project) => !project.isNoProject && project.sessionCount > 0)
    .map((project) => ({ project, sessions: projectSessions(project) })),
  [projectSessions, projects]);
  const fallbackSessions = projects.length === 0
    ? sessions
    : sessions.filter((session) => {
        // projects.tree dapat memakai root lineage atau continuation tip sebagai scope.
        const grouped = scopedIds.has(session.id) || Boolean(session.resolved_id && scopedIds.has(session.resolved_id));
        return !grouped;
      });

  function renderSessionRow(session: SessionSummary) {
    return (
      <button
        key={session.id}
        className="rowcard"
        onClick={() => {
          if (longPressFired.current) {
            longPressFired.current = false;
            return;
          }
          onOpenChat(session);
        }}
        onPointerDown={(event) => onRowPointerDown(event, session)}
        onPointerMove={onRowPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
      >
        <span
          className="sess-avatar"
          style={{
            background: botTint(session.title || "?").bg,
            color: botTint(session.title || "?").fg,
          }}
        >
          {(session.title || "?").trim().charAt(0)}
        </span>
        <div className="rowcard-main">
          <div className="rowcard-title">
            {session.title || "Untitled"}
            {isRelaySession(session) && <span className="chip" style={RELAY_CHIP_STYLE}>relay</span>}
            {isActive(conn.id, session.id, session.resolved_id) && (
              <span className="chip chip-amber chip-live">active</span>
            )}
          </div>
          <div className="rowcard-sub">{session.preview || "—"}</div>
        </div>
        <div className="rowcard-meta">
          {formatSessionTime(session, "")}
          <br />
          {session.message_count} msg
        </div>
      </button>
    );
  }

  return (
    <div className="screen">
      <div className="body chatlist">
        {error && <div className="error-line">{error}</div>}
        {sessions.length === 0 && !error && (
          <div className="hint">No sessions on this machine yet. Start one with the + button above.</div>
        )}
        {projectRows.map(({ project, sessions: rows }) => {
          const open = expanded.has(project.id);
          const visibleRows = hydrated[project.id] ? rows : rows.slice(0, 3);
          return (
            <section key={project.id} className="project-group">
              <button
                type="button"
                className="project-group-head"
                aria-expanded={open}
                onClick={() => void toggleProject(project)}
              >
                {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                <span className="project-group-name">{project.label}</span>
                <span className="project-group-count">{project.sessionCount}</span>
              </button>
              {open && (
                <div className="project-group-rows">
                  {loadingProject === project.id && <div className="hint">Loading sessions…</div>}
                  {loadingProject !== project.id && visibleRows.map(renderSessionRow)}
                  {loadingProject !== project.id && visibleRows.length === 0 && (
                    <div className="hint">No sessions</div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {fallbackSessions.length > 0 && (
          <section className="project-group">
            <button
              type="button"
              className="project-group-head"
              aria-expanded={recentExpanded}
              onClick={() => setRecentExpanded((open) => !open)}
            >
              {recentExpanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
              <span className="project-group-name">Recent</span>
              <span className="project-group-count">{fallbackSessions.length}</span>
            </button>
            {recentExpanded && (
              <div className="project-group-rows">{fallbackSessions.map(renderSessionRow)}</div>
            )}
          </section>
        )}
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
                <div className="rowcard-title">System relay session</div>
                <div className="hint" style={{ margin: "8px 0 14px" }}>
                  “Bot Chat” is the Bot Mode relay session owned by the system —
                  it can't be deleted from here.
                </div>
                <div className="sheet-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={() => setPendingDelete(null)}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rowcard-title">Delete this session?</div>
                <div className="hint" style={{ margin: "8px 0 14px" }}>
                  “{pendingDelete.title || "Untitled"}” and its entire history
                  will be permanently deleted. This can't be undone.
                </div>
                <div className="sheet-actions">
                  <button
                    className="btn btn-destructive"
                    disabled={deleting}
                    onClick={() => void confirmDelete()}
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={deleting}
                    onClick={() => setPendingDelete(null)}
                  >
                    Cancel
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
