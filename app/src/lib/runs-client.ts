/**
 * runs-client.ts — pure, framework-free client for the Hermes OpenAI-compatible
 * API server Runs surface (`/v1/runs*`, `/v1/capabilities`). No React, no DOM
 * assumptions beyond `fetch` (browsers and Node ≥ 22 both have it), so this
 * module is reusable verbatim from a Node smoke test or another shell.
 *
 * Wire facts (verified against gateway/platforms/api_server.py + the live
 * server on 100.105.150.35:8643):
 *   - Auth is `Authorization: Bearer <API_SERVER_KEY>` on every route.
 *   - GET /v1/runs/{id} → pollable status object:
 *       {object:"hermes.run", run_id, status, created_at, updated_at,
 *        session_id, model, last_event, output?, error?, usage?}
 *     status ∈ queued | running | waiting_for_approval | stopping |
 *              completed | failed | cancelled. Terminal statuses are retained
 *     only briefly, so a tracked run can legitimately start 404-ing.
 *   - GET /v1/runs/{id}/events is a PERSISTENT SSE stream (aiohttp
 *     StreamResponse, frames are `data: <json>\n\n`, `: keepalive` comments).
 *     We read it once with a client-side deadline and cancel — the caller gets
 *     the buffered slice, never a hanging request. For finished runs the
 *     stream registry is already gone and the route returns 404 → we resolve
 *     to an empty event list (the UI then falls back to status fields only).
 *   - There is NO server-side run listing: `GET /v1/runs` is 405 on the live
 *     server (only POST exists there). `listRuns()` therefore tries the route
 *     first (forward-compatible with a future list endpoint) and otherwise
 *     falls back to polling the caller's locally tracked run ids.
 *
 * Credential storage note: the API key lives in `localStorage` under
 * `hermes-mobile.api-server-key` — same deliberate v1 trade-off as
 * hermes-client.ts (private tailnet only; encrypted storage is backlog).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface RunInfo {
  object?: string;
  run_id: string;
  status: string;
  created_at?: number;
  updated_at?: number;
  session_id?: string;
  model?: string;
  last_event?: string;
  output?: string;
  error?: string;
  usage?: RunUsage;
  /** Local marker set by the tracked-id fallback when the server already
   *  forgot the run (terminal statuses expire server-side). */
  expired?: boolean;
  [key: string]: unknown;
}

export interface RunEvent {
  event: string;
  run_id?: string;
  timestamp?: number;
  tool?: string;
  preview?: string;
  duration?: number;
  error?: unknown;
  text?: string;
  delta?: string;
  output?: string;
  choices?: string[];
  command?: string;
  usage?: RunUsage;
  [key: string]: unknown;
}

export interface Capabilities {
  object?: string;
  platform?: string;
  model?: string;
  features?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TrackedRun {
  id: string;
  label?: string;
  added_at: number;
}

export interface ListRunsResult {
  runs: RunInfo[];
  /** "server" when a real list endpoint answered, "tracked" when we fell
   *  back to polling locally tracked run ids one by one. */
  source: "server" | "tracked";
}

export class RunsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RunsApiError";
    this.status = status;
  }
  /** True for 401/403 — the stored key is missing or rejected. */
  get auth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ---------------------------------------------------------------------------
// Environment shims (keep the module DOM-free and Node-friendly)
// ---------------------------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls) return ls;
  } catch {
    /* access can throw in sandboxed frames */
  }
  return new MemoryStorage();
}

// ---------------------------------------------------------------------------
// RunsClient
// ---------------------------------------------------------------------------

export const API_KEY_STORAGE_KEY = "hermes-mobile.api-server-key";
const TRACKED_STORAGE_KEY = "hermes-mobile.tracked-runs.v1";

export interface RunsClientOptions {
  /** Base URL of the API server, e.g. "http://100.x.x.x:8643". Default "" —
   *  same-origin (the app is served with /v1 mounted next to it). */
  baseUrl?: string;
  /** Explicit key override (Node smoke tests); otherwise read from storage. */
  apiKey?: string;
  storage?: StorageLike;
  fetchFn?: typeof fetch;
}

export class RunsClient {
  readonly baseUrl: string;
  private apiKeyOverride?: string;
  private storage: StorageLike;
  private fetchFn: typeof fetch;

  constructor(options: RunsClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.apiKeyOverride = options.apiKey;
    this.storage = options.storage ?? defaultStorage();
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  // ── API key ─────────────────────────────────────────────────────────────

  getApiKey(): string {
    return (this.apiKeyOverride ?? this.storage.getItem(API_KEY_STORAGE_KEY) ?? "").trim();
  }

  setApiKey(key: string): void {
    this.storage.setItem(API_KEY_STORAGE_KEY, key.trim());
  }

  clearApiKey(): void {
    this.storage.removeItem(API_KEY_STORAGE_KEY);
  }

  // ── Tracked-run registry (the only "list" we have until the server grows
  //    a GET /v1/runs route) ────────────────────────────────────────────────

  listTracked(): TrackedRun[] {
    try {
      const raw = this.storage.getItem(TRACKED_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as TrackedRun[]) : [];
    } catch {
      return [];
    }
  }

  trackRun(id: string, label?: string): void {
    const clean = id.trim();
    if (!clean) return;
    const all = this.listTracked().filter((t) => t.id !== clean);
    all.unshift({ id: clean, label: label?.trim() || undefined, added_at: Date.now() / 1000 });
    // Bounded: the screen polls every entry, so keep the registry small.
    this.storage.setItem(TRACKED_STORAGE_KEY, JSON.stringify(all.slice(0, 50)));
  }

  untrackRun(id: string): void {
    this.storage.setItem(
      TRACKED_STORAGE_KEY,
      JSON.stringify(this.listTracked().filter((t) => t.id !== id)),
    );
  }

  // ── HTTP ────────────────────────────────────────────────────────────────

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = this.getApiKey();
    if (key) headers["Authorization"] = `Bearer ${key}`;
    const resp = await this.fetchFn(`${this.baseUrl}${path}`, { headers });
    if (!resp.ok) {
      let message = `GET ${path} → HTTP ${resp.status}`;
      try {
        const body = (await resp.json()) as { error?: { message?: string } };
        if (body?.error?.message) message = body.error.message;
      } catch {
        /* non-JSON error body — keep the status-line message */
      }
      throw new RunsApiError(resp.status, message);
    }
    return (await resp.json()) as T;
  }

  /** Feature flags + model name of the server. Doubles as the key test. */
  async getCapabilities(): Promise<Capabilities> {
    return await this.request<Capabilities>("/v1/capabilities");
  }

  /** Pollable status for one run. Throws RunsApiError(404) once the server
   *  has expired the run's retained status. */
  async getRun(runId: string): Promise<RunInfo> {
    return await this.request<RunInfo>(`/v1/runs/${encodeURIComponent(runId)}`);
  }

  /**
   * List runs. The live API server has no list route (`GET /v1/runs` → 405),
   * so this tries the route first and otherwise polls every locally tracked
   * run id. Tracked runs that already 404 are returned as tombstones
   * (`expired: true, status: "unknown"`) so the UI can offer untracking.
   */
  async listRuns(): Promise<ListRunsResult> {
    try {
      const data = await this.request<RunInfo[] | { runs?: RunInfo[] }>("/v1/runs");
      const runs = Array.isArray(data) ? data : (data.runs ?? []);
      return { runs, source: "server" };
    } catch (err) {
      if (err instanceof RunsApiError && err.auth) throw err;
      if (!(err instanceof RunsApiError) || (err.status !== 404 && err.status !== 405)) {
        throw err;
      }
    }
    const tracked = this.listTracked();
    const settled = await Promise.allSettled(tracked.map((t) => this.getRun(t.id)));
    const runs: RunInfo[] = [];
    for (let i = 0; i < tracked.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        runs.push(outcome.value);
      } else {
        const reason = outcome.reason;
        if (reason instanceof RunsApiError && reason.auth) throw reason;
        runs.push({
          run_id: tracked[i].id,
          status: "unknown",
          created_at: tracked[i].added_at,
          expired: true,
        });
      }
    }
    // Newest first — the server never hands us an ordering on this path.
    runs.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    return { runs, source: "tracked" };
  }

  /**
   * One-shot read of the run's SSE event stream. The endpoint is a persistent
   * stream, so we read until it closes (run finished) or `timeoutMs` elapses,
   * then cancel and return whatever arrived — never a hanging request.
   * Finished/expired runs answer 404 → empty list (caller falls back to the
   * status fields from getRun).
   */
  async getRunEvents(
    runId: string,
    options: { timeoutMs?: number; maxEvents?: number } = {},
  ): Promise<RunEvent[]> {
    const timeoutMs = options.timeoutMs ?? 8_000;
    const maxEvents = options.maxEvents ?? 200;
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    const key = this.getApiKey();
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const events: RunEvent[] = [];
    try {
      const resp = await this.fetchFn(
        `${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`,
        { headers, signal: controller.signal },
      );
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          throw new RunsApiError(resp.status, `events → HTTP ${resp.status}`);
        }
        return []; // 404: stream registry already gone (finished/expired run)
      }
      if (!resp.body) return [];

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const event = parseSseFrame(frame);
            if (event) {
              events.push(event);
              if (events.length >= maxEvents) {
                await reader.cancel().catch(() => undefined);
                return events;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      return events;
    } catch (err) {
      // The deadline abort is the normal way out for a long-running run —
      // return the partial slice collected so far, never a hang.
      if (err instanceof RunsApiError) throw err;
      if (err instanceof Error && err.name === "AbortError") return events;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse one SSE frame (`data: <json>` lines; `: comment` lines ignored). */
function parseSseFrame(frame: string): RunEvent | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // keepalive / stream-closed comments
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    const parsed = JSON.parse(dataLines.join("\n")) as RunEvent;
    return typeof parsed?.event === "string" ? parsed : null;
  } catch {
    return null;
  }
}
