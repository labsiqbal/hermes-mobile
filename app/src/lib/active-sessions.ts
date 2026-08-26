/**
 * active-sessions.ts — client-side tracking of sessions that are mid-turn.
 * Tracks via message.start / message.complete / error events and persists to
 * localStorage so the badge survives app restarts. No backend changes.
 */

const STORE_KEY = "hermes-mobile.active-sessions.v1";

interface ActiveSession {
  sessionId: string;
  startedAt: number; // epoch ms
}

interface CachedEvent {
  type: string;
  session_id?: string;
  seq?: number;
  payload?: unknown;
}

const eventCache = new Map<string, CachedEvent[]>();
const viewWatermarks = new Map<string, number>();

function load(): ActiveSession[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries: ActiveSession[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

export function markActive(sessionId: string): void {
  const entries = load().filter((e) => e.sessionId !== sessionId);
  entries.push({ sessionId, startedAt: Date.now() });
  save(entries);
}

export function markInactive(sessionId: string): void {
  save(load().filter((e) => e.sessionId !== sessionId));
}

export function isActive(sessionId: string): boolean {
  return load().some((e) => e.sessionId === sessionId);
}

export function getActiveSessions(): ActiveSession[] {
  return load();
}

/** Prune entries older than maxAgeMs (default 10 min) — stale entries from
 *  crashed sessions shouldn't linger forever. */
export function pruneStale(maxAgeMs = 10 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  save(load().filter((e) => e.startedAt > cutoff));
}

/** Keep a small in-memory event window while ChatView is unmounted. */
export function recordSessionEvent(event: CachedEvent): void {
  const sid = event.session_id;
  if (!sid) return;
  const events = eventCache.get(sid) ?? [];
  events.push(event);
  if (events.length > 500) events.splice(0, events.length - 500);
  eventCache.set(sid, events);
}

export function getSessionEvents(sessionId: string): CachedEvent[] {
  return eventCache.get(sessionId) ?? [];
}

export function getViewWatermark(sessionId: string): number {
  return viewWatermarks.get(sessionId) ?? 0;
}

export function markViewWatermark(sessionId: string, seq?: number): void {
  if (typeof seq !== "number" || !Number.isFinite(seq)) return;
  const previous = viewWatermarks.get(sessionId) ?? 0;
  if (seq > previous) viewWatermarks.set(sessionId, seq);
}
