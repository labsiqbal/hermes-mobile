/** Narrow management adapter. Contracts: docs/production/management-contracts.md.
 * No config/env endpoint, implicit profile, login, secret extraction or retries.
 */
import type { HermesConnection } from './hermes-client';

type Gateway = Pick<HermesConnection, 'url' | 'rpc' | 'profilesList'>;
type Json = Record<string, unknown>;
export type ManagementErrorCode = 'scope' | 'auth' | 'unsupported' | 'invalid' | 'network' | 'timeout' | 'aborted' | 'confirmation' | 'conflict' | 'unverified';
export class ManagementError extends Error {
  readonly code: ManagementErrorCode;
  readonly outcome: 'none' | 'unknown';
  readonly status?: number;
  constructor(code: ManagementErrorCode, message: string, outcome: 'none' | 'unknown' = 'none', status?: number) {
    super(`${message} ${outcome === 'none' ? 'No state changed.' : 'The write outcome is unknown. Refresh before trying again.'}`);
    this.name = 'ManagementError';
    this.code = code; this.outcome = outcome; this.status = status;
  }
}
export interface ManagedProfile {
  name: string; description: string; displayName: string; model: string; provider: string; skillCount: number | null;
}
export interface Capability { name: string; enabled: boolean; label: string; description: string; toolCount: number | null; transport: string }
export interface ProfileDetails { name: string; description: string; soul: string; model: string; provider: string; skills: Capability[]; toolsets: Capability[]; mcp: Capability[] }
export interface MemoryNote { id: string; label: string; source: string }
export interface Schedule { id: string; profile: string; name: string; state: string; enabled: boolean | null; schedule: string; nextRun: string; lastRun: string }
export interface MessagingPlatform { id: string; name: string; description: string; state: string; enabled: boolean | null; configured: boolean | null; gatewayRunning: boolean | null }
export interface KanbanBoard { slug: string; name: string }
export interface KanbanTask { id: string; title: string; status: string; assignee: string; body: string }
export interface KanbanColumn { name: string; tasks: KanbanTask[] }
export interface DescriptionReview { readonly profile: string; readonly before: string; readonly after: string }

const object = (v: unknown): Json => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ManagementError('invalid', 'The gateway returned an unexpected response.');
  return v as Json;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new ManagementError('invalid', 'The gateway returned an unexpected list.');
  return v;
};
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const count = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const required = (v: unknown): string => {
  const s = text(v);
  if (!s) throw new ManagementError('invalid', 'A required identifier is missing.');
  return s;
};
function profileName(value: string) {
  // Preserve literal ids; aliases all/current/custom are not explicit profile scopes.
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) || ['all', 'current', 'custom'].includes(value)) {
    throw new ManagementError('scope', 'Choose an explicit, supported profile identifier.');
  }
  return value;
}
function errorFor(err: unknown, mutation = false): ManagementError {
  if (err instanceof ManagementError) return err;
  const row = err && typeof err === 'object' ? err as Json : {};
  const code = row.code;
  const status = typeof row.status === 'number' ? row.status : undefined;
  if (status === 401 || status === 403 || code === 401 || code === 403) return new ManagementError('auth', 'Authentication is required. Reconnect through Settings.', 'none', status);
  if (code === -32601 || code === 4064 || status === 404) return new ManagementError('unsupported', 'This capability or profile is unavailable on this gateway.', 'none', status);
  return new ManagementError('network', 'The management request failed.', mutation ? 'unknown' : 'none', status);
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const limit = 2 * 1024 * 1024;
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!contentType || !/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(contentType)) throw new ManagementError('invalid', 'The endpoint did not return JSON. It may be a static page or login redirect.');
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw new ManagementError('invalid', 'The management response is too large or missing.');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0; let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new ManagementError('invalid', 'The management response exceeds the 2 MiB display limit.');
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof ManagementError) throw error;
    throw new ManagementError('invalid', 'The endpoint returned incomplete or invalid JSON.');
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}

export class ManagementClient {
  private readonly base: string;
  private readonly reviews = new WeakSet<DescriptionReview>();
  private readonly gateway: Gateway;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(gateway: Gateway, fetcher: typeof fetch = globalThis.fetch, timeoutMs = 15_000) {
    this.gateway = gateway; this.fetcher = fetcher; this.timeoutMs = timeoutMs;
    let url: URL;
    try { url = new URL(gateway.url); } catch { throw new ManagementError('scope', 'Invalid gateway address.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new ManagementError('scope', 'Gateway addresses must not contain credentials, queries or fragments.');
    }
    this.base = gateway.url.replace(/\/+$/, '');
  }
  private bounded<T>(run: () => Promise<T>, signal?: AbortSignal, mutation = false): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(errorFor(error, mutation)); else resolve(value as T);
      };
      const abort = () => finish(new ManagementError('aborted', 'Request cancelled.', mutation ? 'unknown' : 'none'));
      const timer = setTimeout(() => finish(new ManagementError('timeout', 'The gateway did not respond in time.', mutation ? 'unknown' : 'none')), this.timeoutMs);
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      // HermesConnection owns WS request cleanup. Cancellation suppresses its late results;
      // it cannot recall a transmitted RPC or prove a timed-out write did not run.
      void Promise.resolve().then(() => {
        if (settled) throw new ManagementError('aborted', 'Request cancelled.');
        return run();
      }).then(value => finish(undefined, value), error => finish(error));
    });
  }
  async profiles(signal?: AbortSignal): Promise<ManagedProfile[]> {
    const rows = await this.bounded(() => this.gateway.profilesList({ includeSessions: false }), signal);
    return list(rows).map(item => {
      const r = object(item);
      return { name: required(r.name), description: text(r.description), displayName: text(r.display_name), model: text(r.model), provider: text(r.provider), skillCount: count(r.skill_count) };
    });
  }
  async describe(profile: string, signal?: AbortSignal): Promise<ProfileDetails> {
    profileName(profile);
    const r = object(await this.bounded(() => this.gateway.rpc('profiles.describe', { name: profile }), signal));
    if (r.name !== profile) throw new ManagementError('scope', 'The response belongs to a different profile. It was not displayed.');
    const capabilities = (v: unknown): Capability[] => list(v).map(item => {
      const c = object(item);
      if (typeof c.enabled !== 'boolean') throw new ManagementError('invalid', 'Capability enablement was not reported.');
      return { name: required(c.name), enabled: c.enabled, label: text(c.label), description: text(c.description), toolCount: count(c.tool_count), transport: text(c.transport) };
    });
    const model = object(r.model);
    return { name: profile, description: text(r.description), soul: text(r.soul), model: text(model.default), provider: text(model.provider), skills: capabilities(r.skills), toolsets: capabilities(r.toolsets), mcp: capabilities(r.mcp_servers) };
  }
  async reviewDescription(profile: string, after: string, signal?: AbortSignal): Promise<DescriptionReview> {
    profileName(profile);
    if (after !== after.trim() || after.length > 1000) throw new ManagementError('invalid', 'Use a description of at most 1,000 characters without outer whitespace.');
    const current = await this.describe(profile, signal);
    const review = Object.freeze({ profile, before: current.description, after });
    this.reviews.add(review);
    return review;
  }
  async confirmDescription(review: DescriptionReview, selectedProfile: string, confirmed: boolean, signal?: AbortSignal): Promise<ProfileDetails> {
    profileName(selectedProfile);
    if (confirmed !== true || !this.reviews.has(review) || review.profile !== selectedProfile) throw new ManagementError('confirmation', 'Review and explicitly confirm this change in its original profile.');
    this.reviews.delete(review); // One attempt only; no replay after failure, cancellation or scope change.
    const latest = await this.describe(selectedProfile, signal);
    if (latest.description !== review.before) throw new ManagementError('conflict', 'The profile description changed since review. Review the latest value.');
    const response = await this.bounded(() => this.gateway.rpc('profiles.configure', { name: selectedProfile, description: review.after }), signal, true);
    try {
      if (object(object(response).applied).description !== true) throw new Error('write not acknowledged');
    } catch { throw new ManagementError('unverified', 'The gateway did not confirm the description write.', 'unknown'); }
    try {
      const readback = await this.describe(selectedProfile, signal);
      if (readback.description !== review.after) throw new Error('readback mismatch');
      return readback;
    } catch { throw new ManagementError('unverified', 'The write was acknowledged, but readback could not verify it.', 'unknown'); }
  }
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new ManagementError('aborted', 'Request cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      return await this.bounded(async () => {
        const response = await this.fetcher(`${this.base}${path}`, {
          method: 'GET', credentials: 'include', headers: { Accept: 'application/json' },
          signal: controller.signal, cache: 'no-store', redirect: 'error',
        });
        if (!response.ok) {
          const code = response.status === 401 || response.status === 403 ? 'auth' : response.status === 404 ? 'unsupported' : 'network';
          throw new ManagementError(code, code === 'auth' ? 'Authentication is required. Reconnect through Settings.' : code === 'unsupported' ? 'This endpoint or profile is unavailable on this gateway.' : 'The gateway refused this read.', 'none', response.status);
        }
        return readJson(response, controller.signal);
      }, signal);
    } catch (e) {
      if (controller.signal.aborted && !signal?.aborted) throw new ManagementError('timeout', 'The gateway did not respond in time.');
      throw errorFor(e);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  }
  private async scopedGet(route: string, profile: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<unknown> {
    profileName(profile);
    // Production proxies /api but not FastAPI's /openapi.json. There is no
    // pinned /api/openapi.json endpoint. Never probe a fictional schema route.
    // Cron has an owner echo checked by schedules(). Other reads lack an echo:
    // restrict them to the gateway process's current profile, NOT sticky active.
    // Thus even a legacy server ignoring ?profile cannot return another profile.
    const requiresCurrent = route !== '/api/cron/jobs';
    const checkCurrent = async (afterRead = false) => {
      const identity = object(await this.get('/api/profiles/active', signal));
      if (identity.current !== profile) throw new ManagementError('scope', afterRead ? 'The gateway profile changed during the read. Results were not displayed.' : 'This read is only available for the gateway’s running profile. The selected profile was not queried.');
    };
    if (requiresCurrent) await checkCurrent();
    const query = new URLSearchParams({ ...params, profile });
    const result = await this.get(`${route}?${query}`, signal);
    if (requiresCurrent) await checkCurrent(true); // Drop result if the process scope changed during the read.
    return result;
  }
  async memories(profile: string, signal?: AbortSignal): Promise<MemoryNote[]> {
    const graph = object(await this.scopedGet('/api/learning/graph', profile, {}, signal));
    return list(graph.nodes).map(object).filter(n => n.kind === 'memory').map(n => ({ id: required(n.id), label: text(n.label), source: text(n.memorySource) }));
  }
  async memoryDetail(profile: string, id: string, signal?: AbortSignal): Promise<string> {
    if (!/^memory:(memory|profile):\d+$/.test(id)) throw new ManagementError('invalid', 'Unsupported memory identifier.');
    const r = object(await this.scopedGet('/api/learning/node', profile, { id }, signal));
    if (r.ok !== true || r.kind !== 'memory' || r.id !== id) throw new ManagementError('invalid', 'The memory response did not match the request.');
    return required(r.content);
  }
  async schedules(profile: string, signal?: AbortSignal): Promise<Schedule[]> {
    return list(await this.scopedGet('/api/cron/jobs', profile, {}, signal)).map(item => {
      const r = object(item);
      if (r.profile !== profile) throw new ManagementError('scope', 'Schedule ownership did not match the selected profile. Results were not displayed.');
      return { id: required(r.id), profile, name: text(r.name), state: text(r.state), enabled: bool(r.enabled), schedule: text(r.schedule_display), nextRun: text(r.next_run_at), lastRun: text(r.last_run_at) };
    });
  }
  /** Kanban boards are explicitly gateway-wide, shared across profiles. */
  async boards(signal?: AbortSignal): Promise<KanbanBoard[]> {
    const r = object(await this.get('/api/plugins/kanban/boards?include_archived=false', signal));
    return list(r.boards).map(item => { const b = object(item); return { slug: required(b.slug), name: text(b.name) }; });
  }
  async board(slug: string, signal?: AbortSignal): Promise<KanbanColumn[]> {
    // Select a literal slug returned by boards(); never use the mutable current-board pointer.
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) throw new ManagementError('scope', 'Choose an explicit board slug.');
    const known = await this.boards(signal);
    if (!known.some(b => b.slug === slug)) throw new ManagementError('scope', 'The selected board is no longer available.');
    const r = object(await this.get(`/api/plugins/kanban/board?board=${encodeURIComponent(slug)}&include_archived=false`, signal));
    return list(r.columns).map(item => {
      const column = object(item);
      return { name: required(column.name), tasks: list(column.tasks).map(item => {
        const t = object(item);
        return { id: required(t.id), title: text(t.title), status: text(t.status), assignee: text(t.assignee), body: text(t.body) };
      }) };
    });
  }
  async messaging(profile: string, signal?: AbortSignal): Promise<MessagingPlatform[]> {
    const r = object(await this.scopedGet('/api/messaging/platforms', profile, {}, signal));
    return list(r.platforms).map(item => {
      const p = object(item);
      // Deliberately drop env_vars (including redacted_value), home_channel,
      // server error strings, paths and commands before data reaches React.
      return { id: required(p.id), name: text(p.name), description: text(p.description), state: text(p.state), enabled: bool(p.enabled), configured: bool(p.configured), gatewayRunning: bool(p.gateway_running) };
    });
  }
}
