/**
 * Runs.tsx — timeline run agent (prompt turn + tool execution) via the Hermes
 * OpenAI-compatible API server (`/v1/runs*`, same-origin mount).
 *
 * Design notes:
 *  - The API key is user-supplied by design: it is never bundled with the
 *    app. When missing (or rejected with 401) the screen shows the key card
 *    instead of the list.
 *  - The live server has no run-listing route (`GET /v1/runs` → 405), so the
 *    list falls back to polling locally tracked run ids (see runs-client.ts);
 *    a small "Lacak run" form is how ids enter the registry.
 *  - Run details come from `GET /v1/runs/{id}`; the events timeline is a
 *    one-shot read of the SSE stream (persistent SSE is intentionally not
 *    held open). Finished runs 404 on /events → detail fields only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HermesConnection, SavedConnection } from "../lib/hermes-client";
import {
  RunsApiError,
  RunsClient,
  type RunEvent,
  type RunInfo,
} from "../lib/runs-client";

const REFRESH_MS = 15_000;
const EVENTS_TIMEOUT_MS = 8_000;

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_for_approval", "stopping"]);

const STATUS_LABEL: Record<string, string> = {
  queued: "antre",
  running: "berjalan",
  waiting_for_approval: "menunggu approval",
  stopping: "berhenti…",
  completed: "selesai",
  failed: "gagal",
  cancelled: "dibatalkan",
  unknown: "tidak dikenal",
};

interface DetailState {
  loading: boolean;
  run?: RunInfo;
  events?: RunEvent[];
  error?: string;
}

function fmtClock(epoch?: number): string {
  if (!epoch) return "—";
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(run: RunInfo): string {
  if (!run.created_at) return "";
  const end = ACTIVE_STATUSES.has(run.status) ? Date.now() / 1000 : (run.updated_at ?? 0);
  const secs = Math.max(0, Math.round(end - run.created_at));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

/** Merge consecutive text-delta events (server emits `message.delta`) into
 *  one "teks" entry for the timeline. */
function isDelta(e: RunEvent): boolean {
  return e.event === "message.delta" || e.event === "text.delta";
}

function mergeDeltas(events: RunEvent[]): RunEvent[] {
  const out: RunEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (isDelta(e) && prev && isDelta(prev)) {
      prev.delta = `${prev.delta ?? ""}${e.delta ?? ""}`;
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

function eventLine(e: RunEvent): string {
  const ts = fmtClock(e.timestamp);
  switch (e.event) {
    case "tool.started":
      return `${ts}  ▶ ${e.tool ?? "tool"}`;
    case "tool.completed":
      return `${ts}  ${e.error ? "✕" : "✓"} ${e.tool ?? "tool"}${e.duration != null ? ` (${e.duration}s)` : ""}`;
    case "reasoning.available":
      return `${ts}  reasoning`;
    case "text.delta":
    case "message.delta":
      return `${ts}  teks`;
    case "approval.request":
      return `${ts}  menunggu approval`;
    case "run.started":
      return `${ts}  run mulai`;
    case "run.completed":
      return `${ts}  run selesai`;
    case "run.failed":
      return `${ts}  run gagal`;
    case "run.cancelled":
      return `${ts}  run dibatalkan`;
    case "subagent.start":
      return `${ts}  subagent mulai`;
    case "subagent.complete":
      return `${ts}  subagent selesai${e.status ? ` (${e.status})` : ""}`;
    default:
      return `${ts}  ${e.event}`;
  }
}

function eventPreview(e: RunEvent): string {
  const raw =
    (typeof e.preview === "string" && e.preview) ||
    (typeof e.delta === "string" && e.delta) ||
    (typeof e.command === "string" && e.command) ||
    (typeof e.error === "string" && e.error) ||
    "";
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

export function Runs({ client, conn }: { client?: HermesConnection; conn?: SavedConnection }) {
  void client; // reserved for future device labeling; the API key flow is per-device
  const api = useMemo(() => new RunsClient(), []);
  const [hasKey, setHasKey] = useState(() => api.getApiKey() !== "");
  const [keyRejected, setKeyRejected] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const [runs, setRuns] = useState<RunInfo[] | null>(null);
  const [source, setSource] = useState<"server" | "tracked">("server");
  const [listError, setListError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [trackDraft, setTrackDraft] = useState("");

  const load = useCallback(async () => {
    if (!api.getApiKey()) return;
    try {
      const result = await api.listRuns();
      setRuns(result.runs);
      setSource(result.source);
      setListError("");
      setKeyRejected(false);
    } catch (err) {
      if (err instanceof RunsApiError && err.auth) {
        setKeyRejected(true);
        return;
      }
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh hanya saat ada run aktif.
  const hasActive = (runs ?? []).some((r) => ACTIVE_STATUSES.has(r.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  async function saveKey() {
    const draft = keyDraft.trim();
    if (!draft || keyBusy) return;
    setKeyBusy(true);
    setKeyMsg(null);
    try {
      const probe = new RunsClient({ apiKey: draft });
      const caps = await probe.getCapabilities();
      api.setApiKey(draft);
      setHasKey(true);
      setKeyRejected(false);
      setKeyDraft("");
      setKeyMsg({ kind: "ok", text: `Key diterima — model ${caps.model ?? "hermes-agent"}.` });
      await load();
    } catch (err) {
      if (err instanceof RunsApiError && err.auth) {
        setKeyMsg({ kind: "error", text: "Key ditolak server (401) — periksa API_SERVER_KEY di ~/.hermes/.env." });
      } else {
        setKeyMsg({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setKeyBusy(false);
    }
  }

  async function toggleRun(run: RunInfo) {
    const id = run.run_id;
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (details[id]?.loading || details[id]?.run) return;
    setDetails((d) => ({ ...d, [id]: { loading: true } }));
    const [runRes, eventsRes] = await Promise.allSettled([
      api.getRun(id),
      api.getRunEvents(id, { timeoutMs: EVENTS_TIMEOUT_MS }),
    ]);
    setDetails((d) => ({
      ...d,
      [id]: {
        loading: false,
        run: runRes.status === "fulfilled" ? runRes.value : run,
        events: eventsRes.status === "fulfilled" ? eventsRes.value : undefined,
        error:
          runRes.status === "rejected" && !(runRes.reason instanceof RunsApiError && runRes.reason.status === 404)
            ? runRes.reason instanceof Error
              ? runRes.reason.message
              : String(runRes.reason)
            : undefined,
      },
    }));
  }

  function addTracked() {
    const id = trackDraft.trim();
    if (!id) return;
    api.trackRun(id);
    setTrackDraft("");
    void load();
  }

  function removeTracked(id: string) {
    api.untrackRun(id);
    if (expanded === id) setExpanded(null);
    void load();
  }

  // ── key card (belum ada key / key ditolak) ──────────────────────────────

  if (!hasKey || keyRejected) {
    return (
      <div className="screen">
        <div className="body">
          <div className="section-label">API Server</div>
          <div className="card form-stack">
            <div className="hint">
              API key (dari server <span className="mono">~/.hermes/.env</span>{" "}
              <span className="mono">API_SERVER_KEY</span>)
            </div>
            {keyRejected && (
              <div className="error-line">
                Key ditolak server (401) — masukkan ulang key yang benar.
              </div>
            )}
            <input
              className="field mono"
              type="password"
              placeholder="tempel API key…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveKey();
              }}
            />
            {keyMsg && (
              <div className={keyMsg.kind === "error" ? "error-line" : "ok-line"}>{keyMsg.text}</div>
            )}
            <button className="btn btn-primary" disabled={!keyDraft.trim() || keyBusy} onClick={() => void saveKey()}>
              {keyBusy ? "Menguji…" : "Simpan & tes"}
            </button>
          </div>
          <div className="hint">
            Key disimpan lokal di device ini dan dipakai sebagai Bearer token ke{" "}
            <span className="mono">/v1</span> (same-origin).
          </div>
        </div>
      </div>
    );
  }

  // ── list view ───────────────────────────────────────────────────────────

  return (
    <div className="screen">
      <div className="body">
        <div className="section-label">Runs{conn?.label ? ` · ${conn.label}` : ""}</div>
        {source === "tracked" && (
          <div className="hint">
            Server belum menyediakan daftar run — menampilkan run yang dilacak device ini.
          </div>
        )}
        {listError && <div className="error-line">{listError}</div>}

        <div className="card form-stack">
          <div className="hint">Lacak run berdasarkan ID (mis. dari client lain):</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="field mono"
              style={{ flex: 1, minWidth: 0 }}
              placeholder="run_…"
              value={trackDraft}
              onChange={(e) => setTrackDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTracked();
              }}
            />
            <button
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 16px" }}
              disabled={!trackDraft.trim()}
              onClick={addTracked}
            >
              Lacak
            </button>
          </div>
        </div>

        {runs === null && !listError && <div className="hint">Memuat…</div>}
        {runs !== null && runs.length === 0 && (
          <div className="hint">
            Belum ada run yang dilacak. Buat run lewat <span className="mono">POST /v1/runs</span>{" "}
            dari client lain, lalu lacak ID-nya di sini.
          </div>
        )}

        {(runs ?? []).map((run) => {
          const status = run.status || "unknown";
          const isFailed = status === "failed" || status === "cancelled";
          const dotClass = ACTIVE_STATUSES.has(status)
            ? "dot-busy"
            : status === "completed"
              ? "dot-on"
              : "dot-off";
          const tracked = api.listTracked().find((t) => t.id === run.run_id);
          const title = tracked?.label || run.session_id || shortId(run.run_id);
          const isOpen = expanded === run.run_id;
          const detail = details[run.run_id];

          return (
            <div key={run.run_id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="rowcard" onClick={() => void toggleRun(run)}>
                <span
                  className={`dot ${dotClass}`}
                  style={isFailed ? { background: "var(--red)" } : undefined}
                />
                <div className="rowcard-main">
                  <div className="rowcard-title">{title}</div>
                  <div className="rowcard-sub">
                    {STATUS_LABEL[status] ?? status}
                    {run.model ? ` · ${run.model}` : ""}
                    {run.expired ? " · status kedaluwarsa" : ""}
                  </div>
                </div>
                <div className="rowcard-meta">
                  {fmtClock(run.created_at)}
                  <br />
                  {fmtDuration(run)}
                </div>
              </button>

              {isOpen && (
                <div className="card card-sunken" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="rowcard-meta" style={{ textAlign: "left", whiteSpace: "normal" }}>
                    {run.run_id}
                  </div>
                  {detail?.loading && <div className="hint">Memuat timeline…</div>}
                  {detail?.error && <div className="error-line">{detail.error}</div>}
                  {detail?.run?.error && <div className="error-line">{detail.run.error}</div>}

                  {detail?.run?.usage && (
                    <div className="rowcard-meta" style={{ textAlign: "left" }}>
                      tokens in {detail.run.usage.input_tokens ?? 0} · out{" "}
                      {detail.run.usage.output_tokens ?? 0} · total {detail.run.usage.total_tokens ?? 0}
                    </div>
                  )}

                  {detail?.events && detail.events.length > 0 && (
                    <>
                      <div className="section-label">Timeline</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {mergeDeltas(detail.events).map((e, i) => (
                          <div key={i}>
                            <div className="rowcard-sub mono" style={{ fontSize: 10.5 }}>
                              {eventLine(e)}
                            </div>
                            {eventPreview(e) && (
                              <div className="toolcard-out" style={{ maxHeight: 60, marginTop: 2 }}>
                                {eventPreview(e)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {detail?.events && detail.events.length === 0 && !detail.loading && (
                    <div className="hint">
                      Stream events tidak tersedia (run sudah selesai) — menampilkan status saja.
                    </div>
                  )}

                  {detail?.run?.output && (
                    <>
                      <div className="section-label">Output</div>
                      <div className="toolcard">
                        <div className="toolcard-out" style={{ maxHeight: 200 }}>
                          {detail.run.output}
                        </div>
                      </div>
                    </>
                  )}

                  {source === "tracked" && (
                    <button
                      className="btn btn-destructive"
                      style={{ padding: "8px 12px", fontSize: 12 }}
                      onClick={() => removeTracked(run.run_id)}
                    >
                      Berhenti melacak
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <button
          className="btn btn-ghost"
          style={{ padding: "8px 12px", fontSize: 12 }}
          onClick={() => {
            api.clearApiKey();
            setHasKey(false);
            setRuns(null);
            setKeyMsg(null);
          }}
        >
          Ganti API key
        </button>
      </div>
    </div>
  );
}
