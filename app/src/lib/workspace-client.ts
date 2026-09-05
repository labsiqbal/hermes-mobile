/* oxlint-disable eslint/no-control-regex -- Reject control characters at every untrusted text/path boundary. */
import type { HermesConnection, SavedConnection, SessionSummary } from './hermes-client';

export const WORKSPACE_LIMITS = { entries: 200, fileBytes: 128 * 1024, responseBytes: 1024 * 1024, lines: 1200, characters: 128 * 1024, timeoutMs: 15_000 } as const;
export class WorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'WorkspaceError'; this.code = code; }
}
function fail(code: string, message: string): never { throw new WorkspaceError(code, message); }
const forbidden = /(?:^\.|(?:^|[-_.])(?:auth|oauth|credential[s]?|secret[s]?|token[s]?|password[s]?|key[s]?|keychain|keystore|pairing)(?:[-_.]|$)|^id_(?:rsa|dsa|ecdsa|ed25519)|\.(?:pem|key|p12|pfx|jks|kdbx|gpg|asc|pub)$|^(?:config\.ya?ml|webhook_subscriptions\.json|bws_cache(?:\.enc)?\.json)$)/i;
const hiddenDirectories = new Set(['node_modules', 'dist', 'build', 'target', 'venv', '__pycache__']);

/** Conservative lexical guard: paths are never repaired, decoded or normalized. */
export function safeWorkspacePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > 2048 || !path.startsWith('/') || path === '/' || /[\\%\x00-\x1f\x7f:?#*[\]{}]/.test(path)) return false;
  const parts = path.slice(1).split('/');
  // Only this known structural dot-directory may be an ancestor of an explicit cwd
  // or file. It is not itself browsable, and no other dot/credential name is exempt.
  return parts.every((part, index) => !!part && part.trim() === part && part !== '..' && part !== '.' && (part === '.worktrees' && index < parts.length - 1 || !forbidden.test(part)) && !hiddenDirectories.has(part));
}
function under(root: string, path: string) { return path === root || path.startsWith(`${root}/`); }
function gatewayUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[\\\x00-\x20]/.test(raw)) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch { return fail('context', 'The gateway address is not safely addressable.'); }
}
export interface WorkspaceContext { key: string; gatewayId: string; gatewayUrl: string; profile: string; sessionId: string; cwd: string; repo: string | null }
type ConnectionView = Pick<HermesConnection, 'url' | 'connectionState'>;
export interface WorkspaceEntry { name: string; path: string; directory: boolean; size: number | null }
export interface WorkspaceListing { entries: WorkspaceEntry[]; omitted: boolean }
export interface WorkspaceText { text: string; truncated: boolean }
export interface WorkspaceGitFile { path: string; staged: boolean; unstaged: boolean; untracked: boolean; conflicted: boolean }
export interface WorkspaceGitStatus { branch: string | null; detached: boolean; files: WorkspaceGitFile[]; omitted: boolean }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('response', 'The gateway returned an unsupported response.');
  return value as Record<string, unknown>;
}
function textFile(path: string) { return /\.(?:txt|md|markdown|json|ya?ml|toml|csv|ts|tsx|js|jsx|mjs|cjs|css|html|xml|svg|py|rs|go|c|cpp|h|java|kt|sql|sh)$/i.test(path) || /\/(?:README|LICENSE|Dockerfile|Makefile)$/.test(path); }
function boundedText(text: string): WorkspaceText {
  // Treat likely credentials as a blocked document, not partly redacted output.
  if (/-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH)|\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16})|(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*["']?[^\s"']{8,}/i.test(text)) fail('sensitive', 'This content may contain credentials and cannot be displayed.');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail('binary', 'Binary or control-character content is not displayed.');
  const clipped = text.slice(0, WORKSPACE_LIMITS.characters).split('\n').slice(0, WORKSPACE_LIMITS.lines).map(line => line.slice(0, 2000)).join('\n');
  return { text: clipped, truncated: clipped !== text };
}

/** Browser cookie session established by HermesConnection.login; no token introspection or second login. */
export class WorkspaceClient {
  readonly context: WorkspaceContext;
  private readonly client: ConnectionView;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(conn: SavedConnection, client: ConnectionView, session: SessionSummary | null, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.context = workspaceContext(conn, client, session);
    this.client = client; this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? WORKSPACE_LIMITS.timeoutMs, 1), WORKSPACE_LIMITS.timeoutMs);
  }
  private path(path: string) {
    if (!safeWorkspacePath(path) || !under(this.context.cwd, path)) fail('path', 'That path is outside this workspace or is protected.');
    return path;
  }
  private async get(route: '/api/files' | '/api/files/read' | '/api/git/status' | '/api/git/file-diff', params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    if (this.client.connectionState !== 'open') fail('offline', 'Gateway offline. Reconnect before reading the workspace.');
    if (gatewayUrl(this.client.url) !== this.context.gatewayUrl) fail('context', 'The gateway changed. Reopen the workspace.');
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const query = new URLSearchParams({ ...params, profile: this.context.profile });
    try {
      const response = await this.fetcher(`${this.context.gatewayUrl}${route}?${query}`, { method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal, referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        const messages: Record<number, string> = { 401: 'Gateway sign-in expired. Reconnect from the device screen.', 403: 'The gateway denied access to this workspace.', 404: 'The path or workspace API is unavailable on this gateway.', 413: 'The file exceeds the gateway size limit.', 429: 'Gateway busy. Wait before trying again.' };
        fail(`http-${response.status}`, messages[response.status] ?? 'The gateway could not complete this read.');
      }
      if (!response.headers.get('content-type')?.includes('application/json')) fail('response', 'The gateway did not return JSON. This workspace API may be unavailable.');
      if (Number(response.headers.get('content-length')) > WORKSPACE_LIMITS.responseBytes) fail('size', 'The response exceeds the mobile size limit.');
      if (!response.body) fail('response', 'The gateway returned no response body.');
      const reader = response.body.getReader();
      let size = 0; const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > WORKSPACE_LIMITS.responseBytes) { await reader.cancel(); fail('size', 'The response exceeds the mobile size limit.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (this.client.connectionState !== 'open') fail('offline', 'Gateway disconnected. Read again after reconnecting.');
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { return fail('response', 'The gateway returned invalid JSON.'); }
    } catch (error) {
      if (timedOut) fail('timeout', 'Workspace read timed out. Try again when the gateway is ready.');
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (error instanceof WorkspaceError) throw error;
      return fail('network', 'Workspace request failed. Check the connection and browser access to this gateway.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort(); }
  }
  async list(path: string, signal?: AbortSignal): Promise<WorkspaceListing> {
    this.path(path);
    const data = object(await this.get('/api/files', { path }, signal));
    // Managed list returns canonical paths: reject aliases, never follow them.
    if (data.path !== path || !Array.isArray(data.entries)) fail('context', 'The gateway could not confirm this exact workspace directory.');
    const entries: WorkspaceEntry[] = []; const seen = new Set<string>(); let omitted = false;
    for (const value of data.entries) {
      const row = object(value);
      if (typeof row.name !== 'string' || row.name.includes('/') || row.path !== `${path}/${row.name}` || !safeWorkspacePath(row.path) || typeof row.is_directory !== 'boolean' || seen.has(row.path)) { omitted = true; continue; }
      if (entries.length >= WORKSPACE_LIMITS.entries) { omitted = true; continue; }
      if (!row.is_directory && (typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 0)) { omitted = true; continue; }
      seen.add(row.path); entries.push({ name: row.name, path: row.path, directory: row.is_directory, size: row.is_directory ? null : row.size as number });
    }
    return { entries, omitted };
  }
  private async selectedFile(path: string, signal?: AbortSignal) {
    this.path(path);
    if (!textFile(path)) fail('binary', 'Only supported text files can be inspected.');
    const parent = path.slice(0, path.lastIndexOf('/'));
    const listing = await this.list(parent, signal);
    const entry = listing.entries.find(row => row.path === path && !row.directory);
    if (!entry) fail('path', 'The file is missing, protected, an alias, or outside the visible listing.');
    if (entry.size === null || entry.size > WORKSPACE_LIMITS.fileBytes) fail('size', 'This file is larger than the 128 KiB mobile read limit.');
    return entry;
  }
  async readText(path: string, signal?: AbortSignal): Promise<WorkspaceText> {
    await this.selectedFile(path, signal);
    const data = object(await this.get('/api/files/read', { path }, signal));
    if (data.path !== path || typeof data.size !== 'number' || data.size < 0 || data.size > WORKSPACE_LIMITS.fileBytes || typeof data.data_url !== 'string') fail('response', 'The gateway could not confirm this exact file and size.');
    const match = /^data:[a-zA-Z0-9.+/-]+;base64,([a-zA-Z0-9+/]*={0,2})$/.exec(data.data_url);
    if (!match) fail('response', 'The gateway returned an unsupported file encoding.');
    let text: string;
    try {
      const bytes = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0));
      if (bytes.byteLength !== data.size) fail('response', 'The gateway file size did not match.');
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) { if (error instanceof WorkspaceError) throw error; return fail('binary', 'This file is not valid UTF-8 text.'); }
    return boundedText(text);
  }
  async gitStatus(signal?: AbortSignal): Promise<WorkspaceGitStatus | null> {
    const repo = this.context.repo;
    // Repo-wide status must not expose siblings of a nested session cwd.
    if (!repo || repo !== this.context.cwd) fail('context', 'Git status requires this conversation to address the repository root exactly.');
    await this.list(repo, signal); // Reject canonical-root aliases before any Git read.
    const value = await this.get('/api/git/status', { path: repo }, signal);
    if (value === null) return null;
    const data = object(value);
    if (!Array.isArray(data.files) || !(data.branch === null || typeof data.branch === 'string') || typeof data.detached !== 'boolean') fail('response', 'The gateway returned an unsupported Git status.');
    const files: WorkspaceGitFile[] = []; let omitted = data.changed !== data.files.length;
    for (const value of data.files) {
      const row = object(value);
      const path = typeof row.path === 'string' ? `${repo}/${row.path}` : '';
      if (!safeWorkspacePath(path) || !under(this.context.cwd, path) || files.length >= WORKSPACE_LIMITS.entries || files.some(file => file.path === path)) { omitted = true; continue; }
      if (!['staged', 'unstaged', 'untracked', 'conflicted'].every(key => typeof row[key] === 'boolean')) fail('response', 'The gateway returned an unsupported Git file status.');
      files.push({ path, staged: row.staged as boolean, unstaged: row.unstaged as boolean, untracked: row.untracked as boolean, conflicted: row.conflicted as boolean });
    }
    return { branch: typeof data.branch === 'string' ? data.branch.slice(0, 160).replace(/[\x00-\x1f]/g, '') : null, detached: data.detached, files, omitted };
  }
  async diff(path: string, signal?: AbortSignal): Promise<WorkspaceText> {
    const repo = this.context.repo;
    if (!repo || repo !== this.context.cwd) fail('context', 'A safely scoped repository root is required.');
    await this.selectedFile(path, signal);
    const data = object(await this.get('/api/git/file-diff', { path: repo, file: path.slice(repo.length + 1) }, signal));
    if (typeof data.diff !== 'string') fail('response', 'The gateway returned an unsupported diff.');
    return boundedText(data.diff);
  }
}

/** Candidate validation only, NOT trust or cookie isolation. Never probes a URL. */
export function safePreviewUrl(raw: string, gateway: string, appOrigin = typeof location === 'undefined' ? '' : location.origin): string | null {
  try {
    const app = new URL(appOrigin);
    const backend = new URL(gatewayUrl(gateway));
    if (!['http:', 'https:'].includes(app.protocol) || app.origin !== appOrigin) return null;
    if (!raw.startsWith('https://') || raw !== raw.trim() || /[\\\x00-\x20\x7f%?#]/.test(raw) || /(?:^|\/)\.\.?(?:\/|$)/.test(raw) || raw.length > 2048) return null;
    const url = new URL(raw);
    // Cookies ignore ports. A different origin is eligible only for explicit UI trust,
    // including when its hostname matches the app or authenticated gateway.
    const hostname = url.hostname.replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || raw.slice(8).split('/')[0].includes('@') || url.search || url.hash || url.origin === backend.origin || url.origin === app.origin || /^(?:localhost|127\.|0\.|\[::1\]|\[::ffff:(?:7f[0-9a-f]{2}:|0:))/.test(hostname) || hostname.endsWith('.localhost') || url.pathname.split('/').some(part => forbidden.test(part) || /%/.test(part))) return null;
    return url.href;
  } catch { return null; }
}

export function workspaceContext(conn: SavedConnection, client: ConnectionView, session: SessionSummary | null): WorkspaceContext {
  const url = gatewayUrl(conn.url);
  if (!conn.id || gatewayUrl(client.url) !== url) fail('context', 'Workspace and live gateway do not match. Return to the conversation.');
  if (!session || !session.profile || !/^[a-zA-Z0-9_-]{1,128}$/.test(session.profile) || !session.id || session.id.length > 256 || /[\x00-\x1f]/.test(session.id) || (session.resolved_id !== undefined && (!session.resolved_id || session.resolved_id.length > 256 || /[\x00-\x1f]/.test(session.resolved_id)))) fail('context', 'Open a conversation with an explicit profile and workspace first.');
  if (!safeWorkspacePath(session.cwd)) fail('context', 'This conversation has no safe absolute workspace path. Home and filesystem roots are not inferred.');
  // A repo can contain cwd, but can never silently expand Files beyond cwd.
  const repo = safeWorkspacePath(session.git_repo_root) && under(session.git_repo_root, session.cwd) ? session.git_repo_root : null;
  const sessionId = session.resolved_id || session.id;
  return Object.freeze({ key: JSON.stringify([conn.id, url, session.profile, sessionId, session.cwd, repo]), gatewayId: conn.id, gatewayUrl: url, profile: session.profile, sessionId, cwd: session.cwd, repo });
}
