/**
 * hermes-client.ts — pure, framework-free client for a gated `hermes serve`
 * dashboard backend. No React, no DOM assumptions beyond `fetch` /
 * `WebSocket` (both exist in browsers and Node ≥ 22), so this module can be
 * reused verbatim from a future Flutter/native shell or a Node smoke test.
 *
 * Wire protocol (verified against hermes-agent 0.20.x):
 *   1. Auth: POST /auth/password-login {provider, username, password}
 *      → session cookies (browser keeps them; same-origin deploy required —
 *      the server hardcodes CORS to localhost and validates Host/WS-Origin
 *      against the bound host + `dashboard.public_url`).
 *      Alternatively any `Authorization: Bearer <access-token>` the gate
 *      accepts (e.g. the HMAC token local tooling mints from
 *      `dashboard.basic_auth.secret`) can be supplied directly.
 *   2. POST /api/auth/ws-ticket → single-use 30s ticket.
 *   3. ws(s)://<host>/api/ws?ticket=<ticket> — newline-delimited JSON-RPC
 *      2.0. Server sends an `event` frame `gateway.ready` right after accept.
 *   4. RPC: {jsonrpc:"2.0", id, method, params} → response {id, result|error}
 *      Events: {method:"event", params:{type, session_id, payload}}.
 *
 * Credential storage note: ConnectionStore persists username+password in
 * `localStorage` (or an injected StorageLike). This is a deliberate v1
 * trade-off — the app is only meant to be reached over a private tailnet.
 * Encrypted secure storage is backlog (see PRODUCT.md).
 */

import { GROUPS_META_KEY, type GroupRegistry } from "./group-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedConnection {
  id: string;
  label: string;
  /** Base URL of the gateway, e.g. "https://node.tailnet.ts.net" or "http://100.x.x.x:9119". */
  url: string;
  username: string;
  password: string;
}

export interface SessionSummary {
  id: string;
  resolved_id?: string;
  title: string;
  preview: string;
  started_at: number;
  message_count: number;
  source: string;
  cwd?: string | null;
  git_repo_root?: string | null;
  git_branch?: string | null;
}

/** Authoritative project tree served by the same gateway RPC as Desktop. */
export interface ProjectLane {
  id: string;
  label: string;
  sessions?: SessionSummary[];
}

export interface ProjectRepo {
  id: string;
  label: string;
  groups?: ProjectLane[];
}

export interface ProjectTreeItem {
  id: string;
  label: string;
  sessionCount: number;
  previewSessions?: SessionSummary[];
  repos?: ProjectRepo[];
  isNoProject?: boolean;
}

export interface ProjectTreeResult {
  projects: ProjectTreeItem[];
  active_id?: string | null;
  scoped_session_ids?: string[];
}

export interface ChatMessage {
  role: string;
  content?: string;
  [key: string]: unknown;
}

export interface SessionInfo {
  model?: string;
  provider?: string;
  profile_name?: string;
  cwd?: string;
  reasoning_effort?: string;
  [key: string]: unknown;
}

/** `model.options` catalog row (desktop ModelOptionProvider shape). */
export interface ModelOptionProvider {
  slug: string;
  name: string;
  models?: string[];
  is_current?: boolean;
}

export interface ModelOptions {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

/** `config.set` envelope for the model/reasoning switch. */
export interface ConfigSetResult {
  key?: string;
  value?: unknown;
  deferred?: boolean;
  confirm_required?: boolean;
  confirm_message?: string;
  warning?: string;
}

export interface ResumeResult {
  /** Live runtime session id — events for this chat carry THIS sid. */
  session_id: string;
  stored_session_id?: string;
  messages: ChatMessage[];
  info?: SessionInfo;
  /** Current runtime state when reopening an existing session. */
  running?: boolean;
  status?: "idle" | "resuming" | "streaming" | string;
  hydrating?: boolean;
  inflight?: {
    assistant?: string;
    streaming?: boolean;
    user?: string;
    error?: string;
  } | null;
}

// ── Bot Mode (roster + canonical "Bot Chat") ────────────────────────────────

/** The exact session title that activates a profile's Bot Mode DM protocol
 *  (the message_agent tool) server-side. Canonical chats are born hidden. */
export const BOT_CHAT_TITLE = "Bot Chat";

/** A session reference attached to a profile row by `profiles.list`
 *  (`include_sessions: true`). `resolved_id` is the compression-lineage tip
 *  (open this one); `id` stays the durable registry row. */
export interface ProfileSessionRef {
  id: string;
  resolved_id?: string;
  title?: string;
  preview?: string;
  started_at?: number;
  last_active?: number;
  message_count?: number;
}

/** One row of the `profiles.list` roster. Bot-managed profiles carry
 *  `ui_meta['hermes-bots']` (written by the Desktop Bots pane). */
export interface ProfileSummary {
  name: string;
  is_default?: boolean;
  model?: string;
  provider?: string;
  description?: string;
  display_name?: string;
  skill_count?: number;
  /** Explicit distinct handle, when the gateway reports one. */
  handle?: string;
  ui_meta?: Record<string, unknown>;
  /**
   * Per-key CAS revision counters for ui_meta (methods_profiles.py — always
   * present, possibly `{}`, on gateways with the CAS contract; its presence
   * is the feature-detect Desktop uses for `supportsCas`).
   */
  ui_meta_revisions?: Record<string, number>;
  /** Newest human-facing session (roster preview/activity). */
  last_session?: ProfileSessionRef | null;
  /** Freshest kanban/tool worker — heartbeats ≤60s while running. */
  worker_session?: ProfileSessionRef & { source?: string };
  /** The profile's canonical "Bot Chat" registry row, resolved server-side. */
  canonical_session?: ProfileSessionRef | null;
  has_avatar?: boolean;
  [key: string]: unknown;
}

export interface CreateResult extends ResumeResult {
  message_count?: number;
}

/** Result shape of `profiles.configure` (methods_profiles.py): every accepted
 *  field reports under `applied`; a ui_meta CAS mismatch lands as
 *  `applied.ui_meta === false` + `ui_meta_conflicts` ({key: {expected,
 *  actual}}) and nothing is written. */
export interface ProfileConfigureResult {
  applied?: {
    ui_meta?: boolean;
    ui_meta_conflicts?: Record<string, { expected?: unknown; actual?: unknown }>;
    ui_meta_revisions?: Record<string, number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ApprovalRequest {
  request_id?: string;
  command?: string;
  description?: string;
  choices?: string[]; // e.g. ["once","session","always","deny"]
  [key: string]: unknown;
}

export interface GatewayEvent {
  type: string;
  session_id: string;
  payload?: unknown;
  /**
   * Per-session monotonic sequence stamped server-side on every event frame
   * that carries a session_id (hermes-agent tui_gateway/event_replay.py —
   * `_stamp_event` sets `params.seq`, starting at 1 per session). Absent for
   * session-less global events (gateway.ready, skin.changed) and on backends
   * older than the replay contract. Drives lossless-reconnect watermarks.
   */
  seq?: number;
}

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Recognizable CAS conflict from a `profiles.configure` ui_meta write: the
 * gateway refused the write because `ui_meta_expected_revisions` no longer
 * matches (`applied.ui_meta === false` + `ui_meta_conflicts`). Callers catch
 * this, re-read the profile, merge, and retry with the actual revision.
 */
export class UiMetaConflictError extends Error {
  /** The ui_meta key whose precondition failed (e.g. "hermes-bots-groups"). */
  readonly metaKey: string;
  /** Server-reported {key: {expected, actual}} revision mismatch. */
  readonly conflicts: Record<string, { expected?: unknown; actual?: unknown }>;
  constructor(
    metaKey: string,
    conflicts: Record<string, { expected?: unknown; actual?: unknown }>,
  ) {
    const actual = conflicts[metaKey]?.actual;
    super(
      `ui_meta CAS conflict on "${metaKey}" (remote revision ${String(actual ?? "?")})`,
    );
    this.name = "UiMetaConflictError";
    this.metaKey = metaKey;
    this.conflicts = conflicts;
  }
}

// ---------------------------------------------------------------------------
// Small environment shims (keep the module DOM-free and Node-friendly)
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
// Connection registry
// ---------------------------------------------------------------------------

const STORE_KEY = "hermes-mobile.connections.v1";

export class ConnectionStore {
  private storage: StorageLike;

  constructor(storage: StorageLike = defaultStorage()) {
    this.storage = storage;
  }

  list(): SavedConnection[] {
    try {
      const raw = this.storage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as SavedConnection[]) : [];
    } catch {
      return [];
    }
  }

  save(conn: SavedConnection): void {
    const all = this.list().filter((c) => c.id !== conn.id);
    all.push(conn);
    this.storage.setItem(STORE_KEY, JSON.stringify(all));
  }

  remove(id: string): void {
    this.storage.setItem(
      STORE_KEY,
      JSON.stringify(this.list().filter((c) => c.id !== id)),
    );
  }

  get(id: string): SavedConnection | undefined {
    return this.list().find((c) => c.id === id);
  }
}

export function newConnectionId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// HermesConnection — auth + reconnecting JSON-RPC WS client for one gateway
// ---------------------------------------------------------------------------

export interface HermesConnectionOptions {
  /** Base URL, e.g. "http://100.105.150.35:9119". Trailing slash stripped. */
  url: string;
  username?: string;
  password?: string;
  /** Skip password login and use this bearer token for REST auth instead. */
  bearerToken?: string;
  /** Request timeout for RPC calls (default 120s; prompt turns can be slow). */
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Called on every gateway event frame. */
  onEvent?: (event: GatewayEvent) => void;
  /** Called whenever the socket state machine transitions. */
  onState?: (state: ConnectionState) => void;
  /**
   * Lossless reconnect (default TRUE — it only repairs the reconnect gap).
   * After a socket drop + reconnect, events emitted while away are replayed
   * via the `session.events.since` RPC (per-session `seq` watermark) BEFORE
   * live events resume; live frames racing the replay are buffered and
   * seq-deduped, so subscribers see no gap and no duplicates. On a backend
   * without that RPC the replay fails silently and behavior degrades to
   * exactly the legacy one (subscribers refetch state themselves). Set to
   * false to opt out entirely.
   */
  losslessReconnect?: boolean;
  /**
   * Called when the server reports its replay ring was TRUNCATED for a
   * session (the missed gap outgrew the 512-event server buffer): the replay
   * is not gap-free, so the subscriber should refetch full history for that
   * session (e.g. `resumeSession`) instead of trusting the partial replay.
   */
  onReplayTruncated?: (sessionId: string) => void;
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** Replay fetch after reconnect: bounded so a wedged backend can't hold the
 *  live-frame buffer open against the 120s default RPC timeout; generous
 *  enough for a 512-frame server ring to drain. */
const REPLAY_REQUEST_TIMEOUT_MS = 10_000;

/** Result shape of the `session.events.since` RPC
 *  (tui_gateway/methods_session.py ~3640). `events` are BARE event objects
 *  (type/session_id/seq/payload — the frame's `params` dict), not JSON-RPC
 *  envelopes; `truncated` means the gap outgrew the server ring;
 *  `epoch` identifies the server process's seq numbering. */
interface EventsSinceResult {
  events?: GatewayEvent[];
  latest_seq?: number;
  truncated?: boolean;
  count?: number;
  epoch?: string;
}

/**
 * Module-level handle to the most recently connected gateway. Screens mounted
 * without an explicit `client` prop (the App integration contract passes only
 * callbacks) resolve the live connection through `getActiveConnection()`.
 */
let activeConnection: HermesConnection | null = null;

/** The most recently connected HermesConnection, or null when none/disconnected. */
export function getActiveConnection(): HermesConnection | null {
  return activeConnection;
}

export class HermesConnection {
  readonly url: string;
  private username?: string;
  private password?: string;
  private bearerToken?: string;
  private requestTimeoutMs: number;
  private connectTimeoutMs: number;
  private onEventCb?: (event: GatewayEvent) => void;
  private onStateCb?: (state: ConnectionState) => void;
  private eventHandlers = new Set<(event: GatewayEvent) => void>();
  private stateHandlers = new Set<(state: ConnectionState) => void>();

  private socket: WebSocket | null = null;
  private state: ConnectionState = "idle";
  private nextId = 0;
  private pending = new Map<number | string, PendingCall>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = BACKOFF_MIN_MS;
  private stopped = true;
  /** Login cookies captured in non-browser runtimes (Node has no cookie jar). */
  private cookieHeader = "";

  // ── Lossless-reconnect replay state (seq watermarks + dedup buffer) ──────
  private losslessReconnect: boolean;
  private onReplayTruncatedCb?: (sessionId: string) => void;
  /** Per-session last observed event seq — the replay watermark. */
  private lastSeenSeq = new Map<string, number>();
  /** Set while a post-reconnect replay fetch is in flight (dedup guard). */
  private replayInFlight = false;
  /**
   * While a replay fetch is in flight, live seq'd frames for the sessions
   * being replayed are parked here instead of dispatching immediately.
   * Without this hold, a live frame racing the replay response would dispatch
   * twice (once live, once in the replay window) or advance the watermark so
   * the replayed gap events get skipped.
   */
  private replayHold: Map<string, GatewayEvent[]> | null = null;
  /**
   * Server process identity for the replay contract (from gateway.ready /
   * session.events.since). Seq counters are in-process on the backend, so a
   * restart resets them while we still hold high watermarks — without this
   * check a replay would return [] forever and we'd silently believe nothing
   * was missed.
   */
  private replayEpoch: string | null = null;
  private replayGenerationValue = 0;

  constructor(options: HermesConnectionOptions) {
    this.url = options.url.replace(/\/+$/, "");
    this.username = options.username;
    this.password = options.password;
    this.bearerToken = options.bearerToken;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    this.onEventCb = options.onEvent;
    this.onStateCb = options.onState;
    this.losslessReconnect = options.losslessReconnect ?? true;
    this.onReplayTruncatedCb = options.onReplayTruncated;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get replayGeneration(): number {
    return this.replayGenerationValue;
  }

  /** Subscribe to gateway events. Returns an unsubscribe function. */
  addEventHandler(handler: (event: GatewayEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** Subscribe to connection-state transitions. Returns an unsubscribe function. */
  addStateHandler(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.onStateCb?.(state);
    for (const handler of this.stateHandlers) handler(state);
  }

  // ── REST ────────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.bearerToken) headers["Authorization"] = `Bearer ${this.bearerToken}`;
    else if (this.cookieHeader) headers["Cookie"] = this.cookieHeader;
    return headers;
  }

  /** Unauthenticated liveness probe — /api/status is a public endpoint. */
  async status(): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.url}/api/status`);
    if (!resp.ok) throw new AuthError(resp.status, `GET /api/status → HTTP ${resp.status}`);
    return (await resp.json()) as Record<string, unknown>;
  }

  /**
   * Password login (the user-facing path). Sets session cookies — in a
   * browser they ride along automatically on same-origin requests; in Node
   * we capture Set-Cookie into a header manually.
   */
  async login(username?: string, password?: string): Promise<void> {
    const user = username ?? this.username;
    const pass = password ?? this.password;
    if (!user || !pass) throw new AuthError(0, "username and password are required");
    const attempt = () =>
      fetch(`${this.url}/auth/password-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: "basic", username: user, password: pass }),
      });
    let resp = await attempt();
    if (resp.status === 429) {
      // Gateway auth rate limit — one patient retry instead of failing fast.
      await new Promise((r) => setTimeout(r, 2000));
      resp = await attempt();
    }
    if (!resp.ok) {
      throw new AuthError(resp.status, `login failed: HTTP ${resp.status}`);
    }
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      // Node path: keep only the name=value pairs for subsequent requests.
      this.cookieHeader = setCookie
        .split(/,(?=[^;,]+=)/)
        .map((c) => c.split(";")[0].trim())
        .join("; ");
    }
    this.username = user;
    this.password = pass;
  }

  /** Single-use 30s WS ticket. */
  async mintWsTicket(): Promise<string> {
    const resp = await fetch(`${this.url}/api/auth/ws-ticket`, {
      method: "POST",
      headers: this.authHeaders(),
      credentials: "include",
    });
    if (!resp.ok) {
      throw new AuthError(resp.status, `ws-ticket failed: HTTP ${resp.status}`);
    }
    const body = (await resp.json()) as { ticket?: string };
    if (!body.ticket) throw new AuthError(0, "ws-ticket response carried no ticket");
    return body.ticket;
  }

  // ── Socket lifecycle ─────────────────────────────────────────────────────

  /** Open (and keep open) the gateway socket. Resolves on `gateway.ready`. */
  async connect(): Promise<void> {
    this.stopped = false;
    if (this.state === "open" || this.state === "connecting") return;
    await this.openSocket();
    // oxlint-disable-next-line typescript/no-this-alias -- Registry stores the live instance.
    activeConnection = this;
  }

  /** Permanently close; no further reconnects. */
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownSocket();
    if (activeConnection === this) activeConnection = null;
    this.setState("closed");
  }

  private wsUrl(ticket: string): string {
    const base = this.url.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
    return `${base}/api/ws?ticket=${encodeURIComponent(ticket)}`;
  }

  private async openSocket(): Promise<void> {
    this.setState("connecting");
    // Mint the ticket first — the session cookie often outlives a reconnect,
    // so only fall back to password login when it has actually expired (401).
    // Logging in on every reconnect trips the gateway auth rate limit (429).
    let ticket: string;
    if (!this.bearerToken && this.username && this.password) {
      try {
        ticket = await this.mintWsTicket();
      } catch (err) {
        if (err instanceof AuthError && (err.status === 401 || err.status === 403)) {
          await this.login();
          ticket = await this.mintWsTicket();
        } else {
          throw err;
        }
      }
    } else {
      ticket = await this.mintWsTicket();
    }
    const url = this.wsUrl(ticket);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;
      const connectTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new Error("gateway connect timed out"));
        }
      }, this.connectTimeoutMs);

      socket.addEventListener("message", (message) => {
        const data = typeof message.data === "string" ? message.data : "";
        if (!settled) {
          // First frame must be the gateway.ready event.
          try {
            const obj = JSON.parse(data) as {
              method?: string;
              params?: { type?: string; payload?: { replay_epoch?: unknown } };
            };
            if (obj.method === "event" && obj.params?.type === "gateway.ready") {
              // Replay-contract process identity: on backend restart the seq
              // numbering resets, so stale watermarks are dropped here (see
              // adoptReplayEpoch) before any replay runs.
              const epoch = obj.params.payload?.replay_epoch;
              if (typeof epoch === "string" && epoch) this.adoptReplayEpoch(epoch);
              settled = true;
              clearTimeout(connectTimer);
              this.backoffMs = BACKOFF_MIN_MS;
              this.setState("open");
              // Lossless resume: replay events emitted while disconnected.
              // Fire-and-forget so connect() latency is unaffected; no-ops
              // unless seq'd events were observed before the drop.
              void this.fetchReplay();
              resolve();
              return;
            }
          } catch {
            /* fall through to error */
          }
          settled = true;
          clearTimeout(connectTimer);
          socket.close();
          reject(new Error("gateway.ready not received"));
          return;
        }
        this.handleFrame(data);
      });

      socket.addEventListener("close", () => {
        clearTimeout(connectTimer);
        if (this.socket === socket) this.socket = null;
        this.failPending(new Error("WebSocket closed"));
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket closed during handshake"));
        }
        if (this.state !== "closed") {
          this.setState("closed");
          this.scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        clearTimeout(connectTimer);
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
        if (this.state !== "error" && this.state !== "closed") this.setState("error");
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.openSocket().catch(() => {
        // Re-authentication can fail before a WebSocket exists, so there is
        // no close event to schedule the next attempt. Keep the retry loop
        // alive for both HTTP/auth failures and socket-handshake failures.
        if (this.stopped) return;
        this.setState("error");
        this.scheduleReconnect();
      });
    }, delay);
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    this.failPending(new Error("disconnected"));
  }

  private failPending(error: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
  }

  private handleFrame(data: string): void {
    let obj: {
      id?: number | string | null;
      method?: string;
      params?: { type?: string; session_id?: string; seq?: unknown; payload?: unknown };
      result?: unknown;
      error?: { code?: number; message?: string; data?: unknown } | null;
    };
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }
    if (obj.method === "event") {
      const params = obj.params ?? {};
      const event: GatewayEvent = {
        type: String(params.type ?? ""),
        session_id: String(params.session_id ?? ""),
        payload: params.payload,
        ...(typeof params.seq === "number" ? { seq: params.seq } : {}),
      };
      if (
        this.replayHold &&
        event.session_id &&
        typeof event.seq === "number" &&
        this.replayHold.has(event.session_id)
      ) {
        // Replay in flight for this session: park the live frame;
        // flushReplayHold dispatches it after the replayed gap, gated on seq.
        this.replayHold.get(event.session_id)?.push(event);
        return;
      }
      this.recordSeq(event);
      this.dispatchEvent(event);
      return;
    }
    if (obj.id === null || obj.id === undefined) return;
    const call = this.pending.get(obj.id);
    if (!call) return;
    this.pending.delete(obj.id);
    clearTimeout(call.timer);
    if (obj.error) {
      call.reject(
        new RpcError(obj.error.code ?? 0, obj.error.message ?? "rpc error", obj.error.data),
      );
    } else {
      call.resolve(obj.result);
    }
  }

  // ── JSON-RPC ─────────────────────────────────────────────────────────────

  async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket;
    if (this.state !== "open" || !socket) {
      throw new Error("gateway not connected");
    }
    const id = ++this.nextId;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc ${method} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /**
   * rpc() with a per-call timeout override. Used by the reconnect replay,
   * which must not hold buffered live frames hostage to the 120s default on
   * a wedged backend. `rpc()` itself is untouched (signature + behavior).
   */
  private rpcBounded<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    const socket = this.socket;
    if (this.state !== "open" || !socket) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  // ── Lossless reconnect (seq watermark + session.events.since replay) ─────

  private dispatchEvent(event: GatewayEvent): void {
    this.onEventCb?.(event);
    for (const handler of this.eventHandlers) handler(event);
  }

  /**
   * Track each session's last observed event seq. Events without a seq
   * (legacy backend, session-less globals) leave the map untouched.
   */
  private recordSeq(event: GatewayEvent): void {
    const sid = event.session_id;
    const seq = event.seq;
    if (!sid || typeof seq !== "number" || !Number.isFinite(seq)) return;
    const prev = this.lastSeenSeq.get(sid) ?? 0;
    if (seq > prev) this.lastSeenSeq.set(sid, seq);
  }

  /** Telemetry/test hook: snapshot of the per-session replay watermarks. */
  getSeqWatermarks(): Record<string, number> {
    return Object.fromEntries(this.lastSeenSeq);
  }

  /**
   * After a reconnect, ask the gateway to replay every event newer than our
   * per-session watermarks (RPC `session.events.since`, params
   * `{session_id, last_seen}`). Replayed events go through the SAME dispatch
   * path as live frames; dedupe falls out of the seq gate in dispatchIfNewer.
   * Best-effort: any failure (older backend without the RPC, timeout, socket
   * drop mid-replay) is swallowed — subscribers then behave exactly as before
   * this feature existed (refetch state themselves).
   */
  private async fetchReplay(): Promise<void> {
    if (!this.losslessReconnect || this.replayInFlight || this.lastSeenSeq.size === 0) {
      return;
    }
    this.replayInFlight = true;
    // Park live frames for the sessions being replayed so a frame racing the
    // replay response can't dispatch ahead of (or duplicate) the gap events.
    // Sessions without watermarks are unaffected.
    const hold = new Map<string, GatewayEvent[]>();
    for (const sid of this.lastSeenSeq.keys()) hold.set(sid, []);
    this.replayHold = hold;

    try {
      const entries = [...this.lastSeenSeq.entries()];
      // One RPC per known session keeps params flat; sessions are few (<20).
      const results = await Promise.allSettled(
        entries.map(([sid, lastSeen]) =>
          this.rpcBounded<EventsSinceResult>(
            "session.events.since",
            { session_id: sid, last_seen: lastSeen },
            REPLAY_REQUEST_TIMEOUT_MS,
          ),
        ),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const [sid] = entries[i];
        if (result.status !== "fulfilled" || !Array.isArray(result.value?.events)) {
          continue;
        }
        const { epoch } = result.value;
        if (typeof epoch === "string" && epoch && this.replayEpoch && epoch !== this.replayEpoch) {
          // Backend restarted: its seq numbering reset, so our watermarks —
          // and this replay window — are meaningless. Drop them and start
          // fresh under the new epoch.
          this.adoptReplayEpoch(epoch);
          continue;
        }
        if (typeof epoch === "string" && epoch && !this.replayEpoch) {
          this.replayEpoch = epoch;
        }
        if (result.value.truncated) {
          // The gap outgrew the server's 512-event ring: replay is NOT
          // gap-free. Surface it so the subscriber can refetch full history
          // instead of trusting the partial window.
          this.onReplayTruncatedCb?.(sid);
        }
        for (const event of result.value.events) {
          if (!event?.type) continue;
          this.dispatchIfNewer(event);
        }
      }
    } catch {
      // Replay is an optimization over lossy reconnect; never surface errors.
    } finally {
      this.flushReplayHold();
      this.replayInFlight = false;
    }
  }

  /**
   * Dispatch an event only when its seq advances the session watermark.
   * Seq-less events always dispatch (no ordering contract to violate).
   */
  private dispatchIfNewer(event: GatewayEvent): void {
    const sid = event.session_id;
    const seq = event.seq;
    if (sid && typeof seq === "number" && Number.isFinite(seq)) {
      const prev = this.lastSeenSeq.get(sid) ?? 0;
      if (seq <= prev) return;
      this.lastSeenSeq.set(sid, seq);
    }
    this.dispatchEvent(event);
  }

  /**
   * Record the server's replay epoch; on change (backend restart) the old
   * seq watermarks describe a numbering that no longer exists — clear them
   * so the next reconnect doesn't silently believe it missed nothing.
   */
  private adoptReplayEpoch(epoch: string): void {
    if (this.replayEpoch === epoch) return;
    if (this.replayEpoch !== null) {
      this.lastSeenSeq.clear();
      this.replayGenerationValue += 1;
    }
    this.replayEpoch = epoch;
  }

  /** Release frames parked during a replay fetch, seq-gated against dupes. */
  private flushReplayHold(): void {
    const hold = this.replayHold;
    this.replayHold = null;
    if (!hold) return;
    for (const parked of hold.values()) {
      for (const event of parked) this.dispatchIfNewer(event);
    }
  }

  // ── Convenience RPC wrappers ─────────────────────────────────────────────

  async listSessions(options: { limit?: number; title?: string } = {}): Promise<SessionSummary[]> {
    const result = await this.rpc<{ sessions?: SessionSummary[] }>("session.list", {
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.title ? { title: options.title } : {}),
    });
    return result.sessions ?? [];
  }

  /** Same authoritative project overview consumed by Hermes Desktop. */
  async projectTree(previewLimit = 3): Promise<ProjectTreeResult> {
    return await this.rpc<ProjectTreeResult>("projects.tree", { preview_limit: previewLimit });
  }

  /** Hydrated project lanes/sessions, fetched only when a project expands. */
  async projectSessions(projectId: string): Promise<ProjectTreeItem | null> {
    const result = await this.rpc<{ project?: ProjectTreeItem | null }>(
      "projects.project_sessions",
      { project_id: projectId },
    );
    return result.project ?? null;
  }

  async createSession(options: { title?: string; cwd?: string; model?: string } = {}): Promise<CreateResult> {
    return await this.rpc<CreateResult>("session.create", { ...options });
  }

  async resumeSession(sessionId: string): Promise<ResumeResult> {
    return await this.rpc<ResumeResult>("session.resume", { session_id: sessionId });
  }

  /**
   * Submit a prompt. Resolves as soon as the server accepts the turn
   * ({status:"streaming"}); the reply arrives as message.start/delta/complete
   * events on this connection.
   */
  async submitPrompt(sessionId: string, text: string): Promise<{ status?: string }> {
    return await this.rpc<{ status?: string }>("prompt.submit", {
      session_id: sessionId,
      text,
    });
  }

  /** Stage an image (base64 payload) on the session; the gateway consumes
   *  it on the NEXT `prompt.submit` (attached_images queue). */
  async attachImageBytes(params: {
    session_id: string;
    content_base64: string;
    filename?: string;
  }): Promise<{ attached: boolean; path?: string; count?: number }> {
    return await this.rpc("image.attach_bytes", params);
  }

  /** Stage a non-image file; returns an `@file:` ref string for the composer. */
  async attachFile(params: {
    session_id: string;
    data_url: string;
    name: string;
  }): Promise<{ attached: boolean; name?: string; ref_text?: string }> {
    return await this.rpc("file.attach", params);
  }

  /** Un-stage a previously attached image by its gateway path. */
  async detachImage(sessionId: string, path: string): Promise<{ detached: boolean }> {
    return await this.rpc("image.detach", { session_id: sessionId, path });
  }

  /** Catalog for the model picker — same RPC the desktop composer uses. */
  async modelOptions(sessionId: string): Promise<ModelOptions> {
    return await this.rpc<ModelOptions>("model.options", {
      session_id: sessionId,
      explicit_only: true,
    });
  }

  /** Set a session-scoped config key (model / reasoning). Value mirrors the
   *  desktop composer: `"<model> --provider <provider> --session"`. */
  async configSet(
    sessionId: string,
    key: string,
    value: string,
  ): Promise<ConfigSetResult> {
    return await this.rpc<ConfigSetResult>("config.set", {
      session_id: sessionId,
      key,
      value,
    });
  }

  async interruptSession(sessionId: string): Promise<unknown> {
    return await this.rpc("session.interrupt", { session_id: sessionId });
  }

  /**
   * Permanently delete a stored session and its on-disk transcript files
   * (RPC `session.delete`, the same call behind the TUI resume picker's `d`
   * key). There is no undo — delegate subagent children are cascade-deleted,
   * branch/compression children are orphaned. The gateway refuses a session
   * that is still live in that process (error 4023) and unknown ids (4007).
   * `session.close` is NOT a substitute: it only detaches the live runtime
   * and keeps the stored history.
   *
   * Pass the registry row id as listed by `session.list` (for compressed
   * chains that is the projected tip — deleting it orphans the chain root,
   * matching the TUI picker's semantics).
   */
  async sessionDelete(sessionId: string): Promise<{ deleted?: string }> {
    return await this.rpc<{ deleted?: string }>("session.delete", {
      session_id: sessionId,
    });
  }

  /** Answer an approval prompt. choice ∈ "once" | "session" | "always" | "deny". */
  async respondApproval(
    sessionId: string,
    choice: string,
    requestId?: string,
  ): Promise<unknown> {
    return await this.rpc("approval.respond", {
      session_id: sessionId,
      choice,
      ...(requestId ? { request_id: requestId } : {}),
    });
  }

  /** Pending approvals for a session (reconnect catch-up). */
  async pendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
    const result = await this.rpc<{ approvals?: ApprovalRequest[] }>("approval.pending", {
      session_id: sessionId,
    });
    return result.approvals ?? [];
  }

  // ── Bot Mode RPCs (additive; used by the Bots roster screen) ─────────────

  /**
   * Roster of Hermes profiles on this gateway (RPC `profiles.list`).
   * `includeSessions` (default true) attaches last_session / worker_session /
   * canonical_session per profile — the Bots screen needs them for activity
   * status and the Bot Chat open target.
   */
  async profilesList(options: { includeSessions?: boolean } = {}): Promise<ProfileSummary[]> {
    const result = await this.rpc<{ profiles?: ProfileSummary[] }>("profiles.list", {
      include_sessions: options.includeSessions ?? true,
    });
    return result.profiles ?? [];
  }

  /**
   * Exact-title registry lookup of a profile's canonical "Bot Chat"
   * (RPC `session.list` with `title` + `include_hidden` — canonical chats are
   * always hidden, and the exact-title lookup is a window-free identity key).
   * `profile` scopes the lookup to that profile's state.db.
   *
   * FAIL CLOSED by design (mirrors the Desktop plugin): an RPC error throws
   * instead of returning null, so a transient failure can never be misread as
   * "no Bot Chat exists" and fork the bot's forever-chat.
   */
  async sessionFindBotChat(profile?: string): Promise<SessionSummary | null> {
    const result = await this.rpc<{ sessions?: SessionSummary[] }>("session.list", {
      title: BOT_CHAT_TITLE,
      include_hidden: true,
      limit: 5,
      ...(profile ? { profile } : {}),
    });
    const rows = result.sessions ?? [];
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create a profile's ONE forever chat: a session titled exactly "Bot Chat"
   * (activates the Bot Mode protocol + message_agent tool server-side), born
   * hidden from the global session list. `profile` scopes creation to that
   * profile's home. Callers MUST try sessionFindBotChat (or the roster row's
   * canonical_session) first — minting while a "Bot Chat" row exists forks
   * the forever-chat.
   */
  async sessionCreateBotChat(profile?: string): Promise<CreateResult> {
    return await this.rpc<CreateResult>("session.create", {
      title: BOT_CHAT_TITLE,
      hidden: true,
      ...(profile ? { profile } : {}),
    });
  }

  /**
   * Bot Rooms v1: create the backing session for one app-side room — a
   * session titled exactly "Bot Chat" (the Bot Mode protocol trigger
   * server-side) but VISIBLE, unlike the profile's canonical forever-chat
   * (sessionCreateBotChat, hidden: true). Multiple rooms may share the
   * title; callers tell them apart via the local RoomStore sessionId
   * mapping (lib/rooms-store.ts). Unlike the canonical chat there is no
   * find-first requirement — every room gets its own fresh session.
   */
  async sessionCreateRoom(options: { profile?: string } = {}): Promise<CreateResult> {
    return await this.rpc<CreateResult>("session.create", {
      title: BOT_CHAT_TITLE,
      hidden: false,
      ...(options.profile ? { profile: options.profile } : {}),
    });
  }

  // ── ui_meta CAS writes (additive; group registry + bot membership) ──────

  /**
   * Merge-write ui_meta keys on a profile (RPC `profiles.configure`).
   * Server semantics (methods_profiles.py): each top-level key of `uiMeta`
   * REPLACES that key on the profile (`null` deletes it) — spread the old
   * value yourself when patching one field of an object-valued key. When
   * `expectedRevisions` is given, the write is compare-and-swap per key: a
   * mismatch applies NOTHING and answers `applied.ui_meta === false` with
   * `ui_meta_conflicts`. Without it the write is last-writer-wins.
   */
  async profileConfigureUiMeta(params: {
    /** Target profile (default: "default"). */
    name?: string;
    /** Top-level ui_meta keys to replace (value `null` deletes the key). */
    uiMeta: Record<string, unknown>;
    /** CAS preconditions: key → revision the caller based its merge on. */
    expectedRevisions?: Record<string, number>;
  }): Promise<ProfileConfigureResult> {
    return await this.rpc<ProfileConfigureResult>("profiles.configure", {
      name: params.name ?? "default",
      ui_meta: params.uiMeta,
      ...(params.expectedRevisions
        ? { ui_meta_expected_revisions: params.expectedRevisions }
        : {}),
    });
  }

  /**
   * ONE CAS write cycle for the shared group registry (envelope v3 at
   * `default` profile ui_meta['hermes-bots-groups'] — the same slot Desktop's
   * hermes-bots plugin syncs). `expectedRevision` is the remote
   * `ui_meta_revisions['hermes-bots-groups']` the caller read before merging;
   * the gateway bumps it on success and this returns the new revision.
   *
   * On a revision mismatch it throws UiMetaConflictError — the caller is
   * expected to re-read (profilesList), re-merge its room change onto the
   * fresh registry, and retry (bounded, e.g. 3×). Any other refusal (payload
   * >64KB, I/O error) throws a plain Error.
   */
  async syncGroupRegistry(
    registry: GroupRegistry,
    expectedRevision: number,
  ): Promise<number> {
    const result = await this.profileConfigureUiMeta({
      name: "default",
      uiMeta: { [GROUPS_META_KEY]: registry },
      expectedRevisions: { [GROUPS_META_KEY]: expectedRevision },
    });
    const applied = result.applied ?? {};
    if (applied.ui_meta === true) {
      return Number(applied.ui_meta_revisions?.[GROUPS_META_KEY] ?? expectedRevision + 1);
    }
    if (applied.ui_meta_conflicts) {
      throw new UiMetaConflictError(GROUPS_META_KEY, applied.ui_meta_conflicts);
    }
    throw new Error("gateway menolak penulisan registry group (ui_meta)");
  }
}
